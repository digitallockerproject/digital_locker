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
        self.s3.generate_presigned_url.return_value = 'https://s3.example'
        self.s3.get_object_tagging.return_value = dict(TagSet=[dict(Key='LockerMalwareScanStatus', Value='NO_THREATS_FOUND')])
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
        self.s3.generate_presigned_url.assert_not_called()

    def test_upload_reserves_both_quotas_and_signs_exact_size(self):
        result = app.handler(event('/uploads', 'POST', self.data | dict(owner='bob')), None)
        self.assertEqual(result['statusCode'], 201)
        transaction = self.db.transact_write_items.call_args.kwargs['TransactItems']
        self.assertEqual(len(transaction), 3)
        self.assertEqual(transaction[0]['Update']['Key']['pk'], {'S': 'USER#alice'})
        self.assertEqual(transaction[1]['Update']['Key']['pk'], {'S': 'GLOBAL'})
        options = self.s3.generate_presigned_url.call_args.kwargs
        self.assertEqual(options['Params']['ContentLength'], 12)
        self.assertEqual(options['Params']['IfNoneMatch'], '*')
        self.assertEqual(options['ExpiresIn'], 60)

    def test_quota_failure_never_issues_upload_permission(self):
        self.db.transact_write_items.side_effect = ClientError(
            {'Error': {'Code': 'TransactionCanceledException'}, 'CancellationReasons': [{'Code': 'ConditionalCheckFailed'}]}, 'TransactWriteItems')
        self.assertEqual(app.handler(event('/uploads', 'POST', self.data), None)['statusCode'], 409)
        self.s3.generate_presigned_url.assert_not_called()

    def test_other_users_document_is_not_accessible(self):
        self.db.get_item.return_value = {}
        result = app.handler(event('/documents/'+ID+'/download', sub='bob'), None)
        self.assertEqual(result['statusCode'], 404)
        self.assertEqual(self.db.get_item.call_args.kwargs['Key']['pk'], {'S': 'USER#bob'})
        self.s3.generate_presigned_url.assert_not_called()

    def test_pending_download_is_blocked(self):
        self.s3.get_object_tagging.return_value = dict(TagSet=[])
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

    def test_complete_reports_clean_only_with_scan_tag(self):
        result = app.handler(event('/documents/'+ID+'/complete', 'POST'), None)
        self.assertEqual(result['statusCode'], 200)
        self.assertEqual(json.loads(result['body'])['document']['status'], 'Clean')
        self.assertEqual(self.db.update_item.call_args.kwargs['ExpressionAttributeValues'][':status'], {'S': 'Clean'})

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

    def test_no_scan_or_failed_scan_never_issues_download(self):
        for scan in (None, 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED', 'unknown'):
            with self.subTest(scan=scan):
                self.s3.get_object.return_value = dict(Body=io.BytesIO(b'%PDF-1.7'))
                self.s3.get_object_tagging.return_value = dict(TagSet=[] if scan is None else [
                    dict(Key='LockerMalwareScanStatus', Value=scan)])
                self.assertEqual(app.handler(event('/documents/'+ID+'/download'), None)['statusCode'], 409)
        self.s3.generate_presigned_url.assert_not_called()

    def test_cached_clean_status_cannot_bypass_current_scan(self):
        self.item['status'] = 'Clean'
        self.db.get_item.return_value = dict(Item=app.values(self.item))
        self.s3.get_object_tagging.return_value = dict(TagSet=[])
        self.assertEqual(app.handler(event('/documents/'+ID+'/download'), None)['statusCode'], 409)
        self.s3.generate_presigned_url.assert_not_called()

    def test_recent_missing_scan_is_pending(self):
        self.item['createdAt'] = app.datetime.now(app.timezone.utc).isoformat()
        self.db.get_item.return_value = dict(Item=app.values(self.item))
        self.s3.get_object_tagging.return_value = dict(TagSet=[])
        result = app.handler(event('/documents/'+ID+'/complete', 'POST'), None)
        self.assertEqual(json.loads(result['body'])['document']['status'], 'Scanning')

    def test_delete_removes_object_but_does_not_restore_upload_quota(self):
        result = app.handler(event('/documents/'+ID+'/delete', 'POST'), None)
        self.assertEqual(result['statusCode'], 200)
        self.s3.delete_object.assert_called_once_with(Bucket='test-bucket', Key='private/alice/'+ID)
        self.db.transact_write_items.assert_not_called()
        self.assertEqual(self.db.update_item.call_args.kwargs['ExpressionAttributeValues'][':deleted'], {'S': 'Deleted'})

    def test_cannot_delete_until_upload_link_expires(self):
        self.item['createdAt'] = app.datetime.now(app.timezone.utc).isoformat()
        self.db.get_item.return_value = dict(Item=app.values(self.item))
        self.assertEqual(app.handler(event('/documents/'+ID+'/delete', 'POST'), None)['statusCode'], 409)
        self.s3.delete_object.assert_not_called()

    def test_other_owner_cannot_delete(self):
        self.db.get_item.return_value = {}
        self.assertEqual(app.handler(event('/documents/'+ID+'/delete', 'POST', sub='bob'), None)['statusCode'], 404)
        self.s3.delete_object.assert_not_called()

    def test_failed_delete_is_retryable_and_cannot_be_downloaded(self):
        self.s3.delete_object.side_effect = RuntimeError('unavailable')
        self.assertEqual(app.handler(event('/documents/'+ID+'/delete', 'POST'), None)['statusCode'], 503)
        self.assertEqual(self.db.update_item.call_args.kwargs['ExpressionAttributeValues'][':deleted'], {'S': 'Deleting'})
        self.item['status'] = 'Deleting'
        self.db.get_item.return_value = dict(Item=app.values(self.item))
        self.assertEqual(app.handler(event('/documents/'+ID+'/download'), None)['statusCode'], 409)
        self.s3.generate_presigned_url.assert_not_called()
        self.s3.delete_object.side_effect = None
        self.assertEqual(app.handler(event('/documents/'+ID+'/delete', 'POST'), None)['statusCode'], 200)

    def test_deleted_records_cannot_be_reopened(self):
        self.item['status'] = 'Deleted'
        self.db.get_item.return_value = dict(Item=app.values(self.item))
        self.assertEqual(app.handler(event('/documents/'+ID+'/complete', 'POST'), None)['statusCode'], 404)
        self.s3.get_object.assert_not_called()

    def test_share_creation_only_returns_token_once_and_stores_hash(self):
        result = app.handler(event('/documents/'+ID+'/shares', 'POST', {'expiresMinutes': 60, 'maxUses': 2}), None)
        self.assertEqual(result['statusCode'], 201)
        data = json.loads(result['body'])
        self.assertEqual(len(data['token']), 43)
        transaction = self.db.transact_write_items.call_args.kwargs['TransactItems']
        self.assertEqual(len(transaction), 4)
        self.assertNotIn(data['token'], str(transaction))
        self.assertEqual(data['share']['uses'], 0)

    def test_invalid_share_limits_never_write_links(self):
        for options in ({'expiresMinutes': 0, 'maxUses': 1}, {'expiresMinutes': 60, 'maxUses': 11},
                        {'expiresMinutes': 60, 'maxUses': True}, {'expiresMinutes': 10081, 'maxUses': 1}):
            self.assertEqual(app.handler(event('/documents/'+ID+'/shares', 'POST', options), None)['statusCode'], 400)
        self.db.transact_write_items.assert_not_called()

    def test_unscanned_files_cannot_be_shared(self):
        self.s3.get_object_tagging.return_value = {'TagSet': []}
        self.assertEqual(app.handler(event('/documents/'+ID+'/shares', 'POST', {'expiresMinutes': 60, 'maxUses': 1}), None)['statusCode'], 409)
        self.db.transact_write_items.assert_not_called()

    def prepare_link(self, **changes):
        self.item['status'] = 'Clean'
        record = dict(pk='SHARE#hash', sk='LINK', id='a'*64, owner='alice', documentId=ID,
                      expiresAt=int(app.datetime.now(app.timezone.utc).timestamp())+60, maxUses=1, uses=0, revoked=False)
        record.update(changes)
        self.db.get_item.side_effect = [dict(Item=app.values(record)), dict(Item=app.values(self.item))]
        return dict(rawPath='/shares/'+'a'*43+'/redeem', requestContext=dict(http=dict(method='POST')))

    def test_redeem_is_public_but_requires_secret_and_atomic_counter(self):
        request = self.prepare_link()
        result = app.handler(request, None)
        self.assertEqual(result['statusCode'], 200)
        update = self.db.update_item.call_args.kwargs
        self.assertIn('#uses < maxUses', update['ConditionExpression'])
        self.assertIn('expiresAt > :now', update['ConditionExpression'])
        self.assertEqual(self.s3.generate_presigned_url.call_args.kwargs['ExpiresIn'], 15)

    def test_expired_revoked_or_used_links_never_issue_urls(self):
        for changes in (dict(expiresAt=1), dict(uses=1), dict(revoked=True)):
            request = self.prepare_link(**changes)
            self.assertEqual(app.handler(request, None)['statusCode'], 410)
        self.s3.generate_presigned_url.assert_not_called()
        self.db.update_item.assert_not_called()

    def test_concurrent_redeem_loser_does_not_get_download(self):
        request = self.prepare_link()
        self.db.update_item.side_effect = ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'UpdateItem')
        self.assertEqual(app.handler(request, None)['statusCode'], 410)
        self.s3.generate_presigned_url.assert_not_called()

    def test_public_link_get_does_not_consume_uses(self):
        request = self.prepare_link()
        request['requestContext']['http']['method'] = 'GET'
        self.assertEqual(app.handler(request, None)['statusCode'], 401)
        self.db.update_item.assert_not_called()

    def test_revoke_checks_owner_and_document_in_database(self):
        result = app.handler(event('/documents/'+ID+'/shares/'+'a'*64+'/revoke', 'POST'), None)
        self.assertEqual(result['statusCode'], 200)
        update = self.db.update_item.call_args.kwargs
        self.assertIn('#owner = :owner AND documentId = :document', update['ConditionExpression'])
        self.assertEqual(update['ExpressionAttributeValues'][':owner'], {'S': 'alice'})

    def test_other_user_cannot_revoke_a_link(self):
        self.db.get_item.return_value = {}
        result = app.handler(event('/documents/'+ID+'/shares/'+'a'*64+'/revoke', 'POST', sub='bob'), None)
        self.assertEqual(result['statusCode'], 404)
        self.db.update_item.assert_not_called()

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
