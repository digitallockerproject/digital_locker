"""Private uploads. API Gateway verifies JWT signatures before invoking this function."""
import base64
import json
import os
import re
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.config import Config
from botocore.exceptions import ClientError

s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
db = boto3.client('dynamodb')
serialize = TypeSerializer()
deserialize = TypeDeserializer()
TABLE = os.environ['TABLE_NAME']
BUCKET = os.environ['BUCKET_NAME']
CLIENT = os.environ['CLIENT_ID']
ISSUER = os.environ['ISSUER']
MAX_SIZE = 5 * 1024 * 1024
MAX_BYTES = 100 * 1024 * 1024
TYPES = {'pdf': 'application/pdf', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}
CATEGORIES = {'Academic', 'Housing', 'Personal', 'Financial'}


class RequestError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def values(item):
    return {key: serialize.serialize(value) for key, value in item.items()}


def unpack(item):
    return {key: deserialize.deserialize(value) for key, value in item.items()}


def public(item):
    return {key: item[key] for key in ('id', 'name', 'category', 'sizeBytes', 'createdAt', 'status')}


def reply(status, body):
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
            'body': json.dumps(body, default=int)}


def owner(event):
    # Only trust API Gateway's verified claims, never a user ID sent in the body.
    claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
    sub = claims.get('sub', '')
    if (claims.get('token_use') != 'access' or claims.get('client_id') != CLIENT
            or claims.get('iss') != ISSUER or not re.fullmatch(r'[a-zA-Z0-9-]{1,80}', sub)):
        raise RequestError(401, 'Sign in again to continue.')
    return sub


def body(event):
    raw = event.get('body') or '{}'
    if event.get('isBase64Encoded'):
        raw = base64.b64decode(raw, validate=True).decode('utf-8')
    if len(raw) > 4096:
        raise RequestError(400, 'Request is too large.')
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RequestError(400, 'Expected a JSON object.')
    return data


def get_document(sub, document_id):
    result = db.get_item(TableName=TABLE, Key=values({'pk': f'USER#{sub}', 'sk': f'DOC#{document_id}'}), ConsistentRead=True)
    if 'Item' not in result:
        raise RequestError(404, 'Document not found.')
    return unpack(result['Item'])


def reserve(sub, data):
    name, size, category = data.get('name'), data.get('size'), data.get('category')
    if (not isinstance(name, str) or not 1 <= len(name) <= 120
            or any(ord(char) < 32 or ord(char) == 127 or char in '/\\' for char in name)):
        raise RequestError(400, 'Use a filename of 1–120 characters without slashes or control characters.')
    content_type = TYPES.get(name.rsplit('.', 1)[-1].lower())
    if not content_type or data.get('contentType') != content_type:
        raise RequestError(400, 'Choose a PDF, PNG, or JPEG file.')
    if type(size) is not int or not 1 <= size <= MAX_SIZE:
        raise RequestError(400, 'File size must be between 1 byte and 5 MiB.')
    if category not in CATEGORIES:
        raise RequestError(400, 'Choose a valid category.')
    document_id = str(uuid.uuid4())
    key = f'private/{sub}/{document_id}'
    item = {'pk': f'USER#{sub}', 'sk': f'DOC#{document_id}', 'id': document_id,
            'name': name, 'sizeBytes': size, 'category': category, 'contentType': content_type,
            'objectKey': key, 'createdAt': datetime.now(timezone.utc).isoformat(), 'status': 'Pending upload'}
    transactions = []
    # Reserve space atomically before issuing permission to upload. Failed uploads
    # keep their reservation so they cannot bypass the demo's storage ceiling.
    for pk, limit in [(f'USER#{sub}', 20), ('GLOBAL', 100)]:
        transactions.append({'Update': {
            'TableName': TABLE, 'Key': values({'pk': pk, 'sk': 'QUOTA'}),
            'UpdateExpression': 'ADD files :one, reservedBytes :size',
            'ConditionExpression': '(attribute_not_exists(files) OR files < :limit) AND (attribute_not_exists(reservedBytes) OR reservedBytes <= :remaining)',
            'ExpressionAttributeValues': values({':one': 1, ':size': size, ':limit': limit, ':remaining': MAX_BYTES - size})}})
    transactions.append({'Put': {'TableName': TABLE, 'Item': values(item), 'ConditionExpression': 'attribute_not_exists(pk)'}})
    try:
        db.transact_write_items(TransactItems=transactions)
    except ClientError as error:
        if error.response['Error']['Code'] == 'TransactionCanceledException':
            reasons = error.response.get('CancellationReasons', [])
            if any(reason.get('Code') == 'ConditionalCheckFailed' for reason in reasons):
                raise RequestError(409, 'The demo upload limit has been reached. Ask the account owner to review storage.') from error
        raise
    upload = s3.generate_presigned_post(
        BUCKET, key,
        Fields={'Content-Type': content_type, 'x-amz-server-side-encryption': 'AES256'},
        Conditions=[{'Content-Type': content_type}, {'x-amz-server-side-encryption': 'AES256'}, ['content-length-range', size, size]],
        ExpiresIn=60)
    return reply(201, {'document': public(item), 'upload': upload})


def finish(sub, document_id):
    item = get_document(sub, document_id)
    try:
        head = s3.head_object(Bucket=BUCKET, Key=item['objectKey'])
        if head['ContentLength'] != item['sizeBytes'] or head.get('ContentType') != item['contentType']:
            raise RequestError(400, 'The uploaded file does not match its reservation.')
        result = s3.get_object(Bucket=BUCKET, Key=item['objectKey'], Range='bytes=0-7')
        stream = result['Body']
        try:
            prefix = stream.read()
        finally:
            stream.close()
    except ClientError as error:
        if error.response['Error']['Code'] in ('403', 'AccessDenied', '404', 'NoSuchKey', 'NotFound'):
            raise RequestError(409, 'The file has not arrived. Wait for the transfer or upload it again.') from error
        raise
    expected = {'application/pdf': b'%PDF-', 'image/png': b'\x89PNG\r\n\x1a\n', 'image/jpeg': b'\xff\xd8\xff'}
    # A header check catches obvious mismatches. It is not a malware scan.
    if not prefix.startswith(expected[item['contentType']]):
        raise RequestError(400, 'The file contents do not match the selected file type.')
    db.update_item(TableName=TABLE, Key=values({'pk': item['pk'], 'sk': item['sk']}),
                   UpdateExpression='SET #status = :status', ConditionExpression='attribute_exists(pk)',
                   ExpressionAttributeNames={'#status': 'status'}, ExpressionAttributeValues=values({':status': 'Not scanned'}))
    item['status'] = 'Not scanned'
    return reply(200, {'document': public(item)})


def handler(event, context):
    try:
        sub = owner(event)
        method = event.get('requestContext', {}).get('http', {}).get('method')
        path = event.get('rawPath', '')
        if method == 'GET' and path == '/documents':
            result = db.query(TableName=TABLE, KeyConditionExpression='pk = :pk AND begins_with(sk, :prefix)',
                              ExpressionAttributeValues=values({':pk': f'USER#{sub}', ':prefix': 'DOC#'}), ConsistentRead=True)
            documents = [public(unpack(item)) for item in result.get('Items', [])]
            documents.sort(key=lambda item: item['createdAt'], reverse=True)
            return reply(200, {'documents': documents})
        if method == 'POST' and path == '/uploads':
            return reserve(sub, body(event))
        match = re.fullmatch(r'/documents/([a-f0-9-]{36})/(complete|download)', path)
        if match:
            document_id, action = match.groups()
            if method == 'POST' and action == 'complete':
                return finish(sub, document_id)
            if method == 'GET' and action == 'download':
                item = get_document(sub, document_id)
                if item['status'] != 'Not scanned':
                    raise RequestError(409, 'Confirm the upload before downloading it.')
                # Always download as an attachment. Do not render untrusted files inline.
                url = s3.generate_presigned_url('get_object', Params={
                    'Bucket': BUCKET, 'Key': item['objectKey'],
                    'ResponseContentDisposition': 'attachment; filename="document.' + item['name'].rsplit('.', 1)[-1].lower() + '"',
                    'ResponseContentType': 'application/octet-stream'}, ExpiresIn=60)
                return reply(200, {'url': url})
        return reply(404, {'error': 'Route not found.'})
    except RequestError as error:
        return reply(error.status, {'error': error.message})
    except (ValueError, TypeError, UnicodeError):
        return reply(400, {'error': 'Invalid request.'})
    except Exception:
        # Do not log tokens, filenames, signed URLs, or personal data.
        return reply(503, {'error': 'The document service is unavailable. Try again.'})
