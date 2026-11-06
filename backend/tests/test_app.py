import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

os.environ.update(AWS_DEFAULT_REGION='us-east-2', AWS_ACCESS_KEY_ID='testing', AWS_SECRET_ACCESS_KEY='testing',
                  AWS_EC2_METADATA_DISABLED='true', TABLE_NAME='test-table', BUCKET_NAME='test-bucket',
                  CLIENT_ID='test-client', ISSUER='https://issuer.example')
spec = importlib.util.spec_from_file_location('app', Path(__file__).parents[1] / 'app.py')
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
from botocore.exceptions import ClientError

ID = '00000000-0000-0000-0000-000000000001'


def event(path='/documents', method='GET', data=None, sub='alice', **claims):
    verified = dict(sub=sub, token_use='access', client_id='test-client', iss='https://issuer.example')
    verified.update(claims)
    return dict(rawPath=path, requestContext=dict(http=dict(method=method), authorizer=dict(jwt=dict(claims=verified))),
                body=json.dumps(data) if data is not None else None)


class EndpointTests(unittest.TestCase):
    def test_signed_upload_uses_regional_endpoint(self):
        post = app.s3.generate_presigned_post('test-bucket', 'private/test')
        self.assertEqual(post['url'], 'https://test-bucket.s3.us-east-2.amazonaws.com/')


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.s3 = patch.object(app, 's3', Mock()).start()
        self.db = patch.object(app, 'db', Mock()).start()
        self.addCleanup(patch.stopall)
        self.data = dict(name='paper.pdf', size=12, category='Academic', contentType='application/pdf')
        self.item = dict(pk='USER#alice', sk='DOC#'+ID, id=ID, name='paper.pdf', sizeBytes=12,
                         category='Academic', contentType='application/pdf', objectKey='private/alice/'+ID,
                         status='Pending upload', createdAt='2026-11-06T12:00:00+00:00')
        self.db.get_item.return_value = dict(Item=app.values(self.item))
        self.s3.generate_presigned_post.return_value = dict(url='https://s3.example', fields={})
        self.s3.head_object.return_value = dict(ContentLength=12, ContentType='application/pdf')
        self.s3.get_object.return_value = dict(Body=io.BytesIO(b'%PDF-1.7'))

    def test_auth_required_before_database_access(self):
        for claims in [dict(token_use='id'), dict(client_id='wrong'), dict(iss='wrong'), dict(sub='../bob')]:
            with self.subTest(claims=claims):
                self.assertEqual(app.handler(event(**claims), None)['statusCode'], 401)
        self.db.query.assert_not_called()

    def test_missing_authorizer_is_rejected(self):
        self.assertEqual(app.handler(dict(rawPath='/documents'), None)['statusCode'], 401)

    def test_list_uses_verified_owner(self):
        self.db.query.return_value = dict(Items=[app.values(self.item)])
        result = app.handler(event(), None)
        self.assertEqual(result['statusCode'], 200)
        self.assertNotIn('objectKey', json.loads(result['body'])['documents'][0])
        self.assertEqual(self.db.query.call_args.kwargs['ExpressionAttributeValues'][':pk'], {'S': 'USER#alice'})

    def test_rejects_invalid_uploads_before_reserving(self):
        for changes in [dict(size=0), dict(size=True), dict(size=app.MAX_SIZE+1), dict(name='../a.pdf'),
                        dict(name='x.exe'), dict(name='a\n.pdf'), dict(category='other'), dict(contentType='text/html')]:
            with self.subTest(changes=changes):
                result = app.handler(event('/uploads', 'POST', self.data | changes), None)
                self.assertEqual(result['statusCode'], 400)
        self.db.transact_write_items.assert_not_called()
        self.s3.generate_presigned_post.assert_not_called()

    def test_upload_reserves_both_quotas_and_signs_exact_size(self):
        result = app.handler(event('/uploads', 'POST', self.data | dict(owner='bob')), None)
        self.assertEqual(result['statusCode'], 201)
        transaction = self.db.transact_write_items.call_args.kwargs['TransactItems']
        self.assertEqual(len(transaction), 3)
        self.assertEqual(transaction[0]['Update']['Key']['pk'], {'S': 'USER#alice'})
        self.assertEqual(transaction[1]['Update']['Key']['pk'], {'S': 'GLOBAL'})
        options = self.s3.generate_presigned_post.call_args.kwargs
        self.assertIn(['content-length-range', 12, 12], options['Conditions'])
        self.assertEqual(options['ExpiresIn'], 60)

    def test_quota_failure_never_issues_upload_permission(self):
        self.db.transact_write_items.side_effect = ClientError(
            {'Error': {'Code': 'TransactionCanceledException'}, 'CancellationReasons': [{'Code': 'ConditionalCheckFailed'}]}, 'TransactWriteItems')
        self.assertEqual(app.handler(event('/uploads', 'POST', self.data), None)['statusCode'], 409)
        self.s3.generate_presigned_post.assert_not_called()

    def test_other_users_document_is_not_accessible(self):
        self.db.get_item.return_value = {}
        result = app.handler(event('/documents/'+ID+'/download', sub='bob'), None)
        self.assertEqual(result['statusCode'], 404)
        self.assertEqual(self.db.get_item.call_args.kwargs['Key']['pk'], {'S': 'USER#bob'})
        self.s3.generate_presigned_url.assert_not_called()

    def test_pending_download_is_blocked(self):
        self.assertEqual(app.handler(event('/documents/'+ID+'/download'), None)['statusCode'], 409)
        self.s3.generate_presigned_url.assert_not_called()

    def test_complete_requires_matching_size(self):
        self.s3.head_object.return_value['ContentLength'] = 13
        self.assertEqual(app.handler(event('/documents/'+ID+'/complete', 'POST'), None)['statusCode'], 400)
        self.db.update_item.assert_not_called()

    def test_complete_rejects_disguised_content(self):
        self.s3.get_object.return_value = dict(Body=io.BytesIO(b'<script>'))
        self.assertEqual(app.handler(event('/documents/'+ID+'/complete', 'POST'), None)['statusCode'], 400)
        self.db.update_item.assert_not_called()

    def test_complete_reports_not_scanned(self):
        result = app.handler(event('/documents/'+ID+'/complete', 'POST'), None)
        self.assertEqual(result['statusCode'], 200)
        self.assertEqual(json.loads(result['body'])['document']['status'], 'Not scanned')
        self.assertEqual(self.db.update_item.call_args.kwargs['ExpressionAttributeValues'][':status'], {'S': 'Not scanned'})

    def test_missing_file_stays_pending(self):
        for code in ('403', '404'):
            self.s3.head_object.side_effect = ClientError({'Error': {'Code': code}}, 'HeadObject')
            self.assertEqual(app.handler(event('/documents/'+ID+'/complete', 'POST'), None)['statusCode'], 409)
        self.db.update_item.assert_not_called()

    def test_download_is_short_lived_attachment(self):
        self.item['status'] = 'Not scanned'
        self.db.get_item.return_value = dict(Item=app.values(self.item))
        self.s3.generate_presigned_url.return_value = 'https://download.example'
        self.assertEqual(app.handler(event('/documents/'+ID+'/download'), None)['statusCode'], 200)
        options = self.s3.generate_presigned_url.call_args.kwargs
        self.assertEqual(options['ExpiresIn'], 60)
        self.assertTrue(options['Params']['ResponseContentDisposition'].startswith('attachment;'))

    def test_service_errors_do_not_expose_details(self):
        self.db.query.side_effect = Exception('private data')
        result = app.handler(event(), None)
        self.assertEqual(result['statusCode'], 503)
        self.assertNotIn('private data', result['body'])

    def test_malformed_json(self):
        request = event('/uploads', 'POST')
        request['body'] = '{'
        self.assertEqual(app.handler(request, None)['statusCode'], 400)


if __name__ == '__main__':
    unittest.main()
