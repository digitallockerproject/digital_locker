"""Private uploads. API Gateway verifies JWT signatures before invoking this function."""
import base64
import hashlib
import secrets
import json
import os
import re
import uuid
from datetime import datetime, timezone, timedelta

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.config import Config
from botocore.exceptions import ClientError

REGION = os.environ.get('AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-east-2'))
# Regional URLs avoid redirects that browsers reject during an S3 upload.
s3 = boto3.client('s3', region_name=REGION, endpoint_url=f'https://s3.{REGION}.amazonaws.com',
                  config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'}))
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
    if 'Item' not in result or unpack(result['Item']).get('status') == 'Deleted':
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
    upload = {
        'url': s3.generate_presigned_url('put_object', Params={
            'Bucket': BUCKET, 'Key': key, 'ContentType': content_type,
            'ContentLength': size, 'ServerSideEncryption': 'AES256', 'IfNoneMatch': '*'}, ExpiresIn=60),
        'method': 'PUT',
        'headers': {'Content-Type': content_type, 'x-amz-server-side-encryption': 'AES256', 'If-None-Match': '*'},
    }
    return reply(201, {'document': public(item), 'upload': upload})


def inspect(item):
    if item['status'] in ('Deleted', 'Deleting'):
        raise RequestError(409, 'This document is being deleted.')
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
    # Only the scanner's role can write this tag. Missing/error/skipped results
    # never authorize a download, including files uploaded before scanning existed.
    tags = s3.get_object_tagging(Bucket=BUCKET, Key=item['objectKey'])
    scan = next((tag['Value'] for tag in tags.get('TagSet', [])
                 if tag['Key'] == 'LockerMalwareScanStatus'), None)
    status = {'NO_THREATS_FOUND': 'Clean', 'THREATS_FOUND': 'Flagged',
              'UNSUPPORTED': 'Scan unavailable', 'ACCESS_DENIED': 'Scan unavailable',
              'FAILED': 'Scan unavailable'}.get(scan, 'Scanning')
    if scan is None and datetime.now(timezone.utc) - datetime.fromisoformat(item['createdAt']) > timedelta(minutes=15):
        status = 'Scan unavailable'
    if item['status'] != status:
        db.update_item(TableName=TABLE, Key=values({'pk': item['pk'], 'sk': item['sk']}),
                       UpdateExpression='SET #status = :status',
                       ConditionExpression='attribute_exists(pk) AND #status <> :deleted AND #status <> :deleting',
                       ExpressionAttributeNames={'#status': 'status'},
                       ExpressionAttributeValues=values({':status': status, ':deleted': 'Deleted', ':deleting': 'Deleting'}))
    return item | {'status': status}


def finish(sub, document_id):
    return reply(200, {'document': public(inspect(get_document(sub, document_id)))})


def remove(sub, document_id):
    item = get_document(sub, document_id)
    # Give the upload URL time to expire before removing its immutable object.
    if datetime.now(timezone.utc) - datetime.fromisoformat(item['createdAt']) < timedelta(minutes=5):
        raise RequestError(409, 'Wait five minutes after adding a file before deleting it.')
    db.update_item(TableName=TABLE, Key=values({'pk': item['pk'], 'sk': item['sk']}),
                   UpdateExpression='SET #status = :deleted', ConditionExpression='attribute_exists(pk)',
                   ExpressionAttributeNames={'#status': 'status'},
                   ExpressionAttributeValues=values({':deleted': 'Deleting'}))
    s3.delete_object(Bucket=BUCKET, Key=item['objectKey'])
    db.update_item(TableName=TABLE, Key=values({'pk': item['pk'], 'sk': item['sk']}),
                   UpdateExpression='SET #status = :deleted',
                   ExpressionAttributeNames={'#status': 'status'},
                   ExpressionAttributeValues=values({':deleted': 'Deleted'}))
    # Reservations remain counted to bound cumulative scanning and storage usage.
    return reply(200, {'deleted': document_id})


def list_item(item):
    if item['status'] in ('Pending upload', 'Deleted', 'Deleting'):
        return public(item)
    try:
        return public(inspect(item))
    except RequestError:
        return public(item | {'status': 'Scan unavailable'})


def share_key(digest):
    return values({'pk': f'SHARE#{digest}', 'sk': 'LINK'})


def share_public(item):
    return {key: item[key] for key in ('id', 'expiresAt', 'maxUses', 'uses', 'revoked')}


def create_share(sub, document_id, data):
    minutes, maximum = data.get('expiresMinutes'), data.get('maxUses')
    if type(minutes) is not int or not 15 <= minutes <= 10080 or type(maximum) is not int or not 1 <= maximum <= 10:
        raise RequestError(400, 'Choose 15 minutes to 7 days and 1–10 link uses.')
    item = inspect(get_document(sub, document_id))
    if item['status'] != 'Clean':
        raise RequestError(409, 'Only files with a clean scan can be shared.')
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    record = {'pk': f'SHARE#{digest}', 'sk': 'LINK', 'id': digest, 'owner': sub,
              'documentId': document_id, 'expiresAt': int(datetime.now(timezone.utc).timestamp()) + minutes * 60,
              'maxUses': maximum, 'uses': 0, 'revoked': False}
    transactions = []
    for pk, limit in [(f'USER#{sub}', 20), ('GLOBAL', 100)]:
        transactions.append({'Update': {
            'TableName': TABLE, 'Key': values({'pk': pk, 'sk': 'QUOTA'}),
            'UpdateExpression': 'ADD shares :one',
            'ConditionExpression': 'attribute_not_exists(shares) OR shares < :limit',
            'ExpressionAttributeValues': values({':one': 1, ':limit': limit})}})
    for row in [record, {'pk': f'USER#{sub}', 'sk': f'LINK#{document_id}#{digest}', 'id': digest}]:
        transactions.append({'Put': {'TableName': TABLE, 'Item': values(row), 'ConditionExpression': 'attribute_not_exists(pk)'}})
    try:
        db.transact_write_items(TransactItems=transactions)
    except ClientError as error:
        if error.response['Error']['Code'] == 'TransactionCanceledException':
            raise RequestError(409, 'The demo share-link limit has been reached.') from error
        raise
    return reply(201, {'share': share_public(record), 'token': token})


def list_shares(sub, document_id):
    get_document(sub, document_id)
    rows = db.query(TableName=TABLE, KeyConditionExpression='pk = :pk AND begins_with(sk, :prefix)',
                    ExpressionAttributeValues=values({':pk': f'USER#{sub}', ':prefix': f'LINK#{document_id}#'}),
                    ConsistentRead=True)
    links = []
    for row in rows.get('Items', []):
        record = db.get_item(TableName=TABLE, Key=share_key(unpack(row)['id']), ConsistentRead=True)
        if 'Item' in record:
            links.append(share_public(unpack(record['Item'])))
    return reply(200, {'shares': links})


def revoke_share(sub, document_id, digest):
    get_document(sub, document_id)
    try:
        db.update_item(TableName=TABLE, Key=share_key(digest),
                       UpdateExpression='SET revoked = :true',
                       ConditionExpression='#owner = :owner AND documentId = :document',
                       ExpressionAttributeNames={'#owner': 'owner'},
                       ExpressionAttributeValues=values({':true': True, ':owner': sub, ':document': document_id}))
    except ClientError as error:
        if error.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise RequestError(404, 'Share link not found.') from error
        raise
    return reply(200, {'revoked': digest})


def redeem_share(token):
    digest = hashlib.sha256(token.encode()).hexdigest()
    result = db.get_item(TableName=TABLE, Key=share_key(digest), ConsistentRead=True)
    if 'Item' not in result:
        raise RequestError(410, 'This link is unavailable, expired, or has no uses left.')
    record = unpack(result['Item'])
    now = int(datetime.now(timezone.utc).timestamp())
    if record['revoked'] or record['expiresAt'] <= now or record['uses'] >= record['maxUses']:
        raise RequestError(410, 'This link is unavailable, expired, or has no uses left.')
    item = inspect(get_document(record['owner'], record['documentId']))
    if item['status'] != 'Clean':
        raise RequestError(410, 'This file is not available to download.')
    # Atomic reservation prevents simultaneous visitors from exceeding the limit.
    now = int(datetime.now(timezone.utc).timestamp())
    try:
        db.update_item(TableName=TABLE, Key=share_key(digest),
                       UpdateExpression='ADD #uses :one',
                       ConditionExpression='revoked = :false AND expiresAt > :now AND #uses < maxUses',
                       ExpressionAttributeNames={'#uses': 'uses'},
                       ExpressionAttributeValues=values({':one': 1, ':false': False, ':now': now}))
    except ClientError as error:
        if error.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise RequestError(410, 'This link is unavailable, expired, or has no uses left.') from error
        raise
    url = s3.generate_presigned_url('get_object', Params={
        'Bucket': BUCKET, 'Key': item['objectKey'],
        'ResponseContentDisposition': 'attachment; filename="document.' + item['name'].rsplit('.', 1)[-1].lower() + '"',
        'ResponseContentType': 'application/octet-stream'}, ExpiresIn=min(15, record['expiresAt'] - now))
    return reply(200, {'url': url, 'name': item['name']})


def handler(event, context):
    try:
        method = event.get('requestContext', {}).get('http', {}).get('method')
        path = event.get('rawPath', '')
        public_match = re.fullmatch(r'/shares/([A-Za-z0-9_-]{43})/redeem', path)
        if method == 'POST' and public_match:
            return redeem_share(public_match.group(1))
        sub = owner(event)
        share_match = re.fullmatch(r'/documents/([a-f0-9-]{36})/shares(?:/([a-f0-9]{64})/revoke)?', path)
        if share_match:
            document_id, digest = share_match.groups()
            if method == 'POST' and digest:
                return revoke_share(sub, document_id, digest)
            if not digest and method == 'POST':
                return create_share(sub, document_id, body(event))
            if not digest and method == 'GET':
                return list_shares(sub, document_id)
        if method == 'GET' and path == '/documents':
            result = db.query(TableName=TABLE, KeyConditionExpression='pk = :pk AND begins_with(sk, :prefix)',
                              ExpressionAttributeValues=values({':pk': f'USER#{sub}', ':prefix': 'DOC#'}), ConsistentRead=True)
            documents = [list_item(unpack(item)) for item in result.get('Items', [])
                         if unpack(item)['status'] != 'Deleted']
            documents.sort(key=lambda item: item['createdAt'], reverse=True)
            return reply(200, {'documents': documents})
        if method == 'POST' and path == '/uploads':
            return reserve(sub, body(event))
        match = re.fullmatch(r'/documents/([a-f0-9-]{36})/(complete|download|delete)', path)
        if match:
            document_id, action = match.groups()
            if method == 'POST' and action == 'delete':
                return remove(sub, document_id)
            if method == 'POST' and action == 'complete':
                return finish(sub, document_id)
            if method == 'GET' and action == 'download':
                item = get_document(sub, document_id)
                if item['status'] == 'Deleting':
                    raise RequestError(409, 'This document is being deleted.')
                item = inspect(item)
                if item['status'] != 'Clean':
                    raise RequestError(409, 'Download is blocked until a malware scan reports no threats.')
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
