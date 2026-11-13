"""Scan private uploads locally in Lambda. No files are sent to an outside scanner."""
import os
from pathlib import Path
import subprocess
import tempfile
import time

import boto3

s3 = boto3.client('s3')
BUCKET = os.environ['BUCKET_NAME']
TAG = 'LockerMalwareScanStatus'
DEFINITIONS = Path('/tmp/clamdb')
MAX_SIZE = 5 * 1024 * 1024


def definitions():
    DEFINITIONS.mkdir(exist_ok=True)
    stamp = DEFINITIONS / 'checked'
    if stamp.exists() and time.time() - stamp.stat().st_mtime < 86400:
        return
    config = Path('/tmp/freshclam.conf')
    config.write_text(f'DatabaseDirectory {DEFINITIONS}\nDatabaseMirror database.clamav.net\nConnectTimeout 15\nReceiveTimeout 60\nMaxAttempts 1\n')
    result = subprocess.run(['freshclam', '--stdout', f'--config-file={config}'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    if result.returncode != 0 or not any(DEFINITIONS.glob('daily.c?d')):
        raise RuntimeError('Current scan definitions unavailable')
    stamp.touch()


def tag(key, status):
    s3.put_object_tagging(Bucket=BUCKET, Key=key, Tagging={'TagSet': [{'Key': TAG, 'Value': status}]})


def handler(event, context):
    detail = event.get('detail', {})
    key = detail.get('object', {}).get('key', '')
    if detail.get('bucket', {}).get('name') != BUCKET or not key.startswith('private/'):
        return
    # At-least-once delivery is normal. Completed immutable objects need no rescan.
    current = s3.get_object_tagging(Bucket=BUCKET, Key=key)
    if any(t['Key'] == TAG and t['Value'] in ('NO_THREATS_FOUND', 'THREATS_FOUND') for t in current.get('TagSet', [])):
        return
    status = 'FAILED'
    try:
        head = s3.head_object(Bucket=BUCKET, Key=key)
        if not 1 <= head['ContentLength'] <= MAX_SIZE:
            raise ValueError('Object outside scan limits')
        definitions()
        with tempfile.TemporaryDirectory(dir='/tmp') as directory:
            path = Path(directory) / 'upload'
            s3.download_file(BUCKET, key, str(path))
            result = subprocess.run([
                'clamscan', f'--database={DEFINITIONS}', '--no-summary', '--alert-exceeds-max=yes',
                '--alert-encrypted=yes', '--max-filesize=6M', '--max-scansize=25M',
                '--max-recursion=10', '--max-files=100', str(path)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
            status = {0: 'NO_THREATS_FOUND', 1: 'THREATS_FOUND'}.get(result.returncode, 'FAILED')
    except Exception:
        # Never mark clean on missing definitions, timeouts, parser errors or OOM.
        status = 'FAILED'
    tag(key, status)
    return {'status': status}
