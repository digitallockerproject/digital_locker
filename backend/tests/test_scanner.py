import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

os.environ.update(AWS_DEFAULT_REGION='us-east-2', AWS_ACCESS_KEY_ID='testing', AWS_SECRET_ACCESS_KEY='testing',
                  AWS_EC2_METADATA_DISABLED='true', BUCKET_NAME='test-bucket')
spec = importlib.util.spec_from_file_location('scanner', Path(__file__).parents[1] / 'scanner/scanner.py')
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)
real_definitions = scanner.definitions


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.s3 = patch.object(scanner, 's3', Mock()).start()
        self.defs = patch.object(scanner, 'definitions').start()
        self.run = patch.object(scanner.subprocess, 'run', return_value=Mock(returncode=0)).start()
        self.addCleanup(patch.stopall)
        self.s3.get_object_tagging.return_value = {'TagSet': []}
        self.s3.head_object.return_value = {'ContentLength': 12}
        self.event = {'detail': {'bucket': {'name': 'test-bucket'}, 'object': {'key': 'private/alice/id'}}}

    def status(self):
        return self.s3.put_object_tagging.call_args.kwargs['Tagging']['TagSet'][0]['Value']

    def test_clean_requires_successful_real_scanner(self):
        scanner.handler(self.event, None)
        self.assertEqual(self.status(), 'NO_THREATS_FOUND')
        self.defs.assert_called_once()
        self.assertEqual(self.run.call_args.args[0][0], 'clamscan')
        self.assertNotIn('shell', self.run.call_args.kwargs)

    def test_infected_and_engine_error_never_report_clean(self):
        for code, status in ((1, 'THREATS_FOUND'), (2, 'FAILED')):
            self.run.return_value.returncode = code
            scanner.handler(self.event, None)
            self.assertEqual(self.status(), status)

    def test_definition_failure_never_scans_or_reports_clean(self):
        self.defs.side_effect = RuntimeError('No definitions')
        scanner.handler(self.event, None)
        self.assertEqual(self.status(), 'FAILED')
        self.run.assert_not_called()

    def test_timeout_stays_blocked(self):
        self.run.side_effect = TimeoutError()
        scanner.handler(self.event, None)
        self.assertEqual(self.status(), 'FAILED')

    def test_unrelated_buckets_and_keys_are_ignored(self):
        scanner.handler({'detail': {'bucket': {'name': 'other'}, 'object': {'key': 'private/a'}}}, None)
        scanner.handler({'detail': {'bucket': {'name': 'test-bucket'}, 'object': {'key': 'public/a'}}}, None)
        self.s3.get_object_tagging.assert_not_called()

    def test_duplicate_completed_events_do_not_rescan(self):
        self.s3.get_object_tagging.return_value = {'TagSet': [{'Key': scanner.TAG, 'Value': 'NO_THREATS_FOUND'}]}
        scanner.handler(self.event, None)
        self.defs.assert_not_called()
        self.s3.put_object_tagging.assert_not_called()

    def test_oversized_object_is_rejected_before_download(self):
        self.s3.head_object.return_value = {'ContentLength': scanner.MAX_SIZE + 1}
        scanner.handler(self.event, None)
        self.assertEqual(self.status(), 'FAILED')
        self.s3.download_file.assert_not_called()

    def test_failed_freshclam_does_not_create_freshness_stamp(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(scanner, 'DEFINITIONS', Path(directory)):
                self.run.return_value.returncode = 1
                with self.assertRaises(RuntimeError):
                    real_definitions()
                self.assertFalse((Path(directory) / 'checked').exists())


if __name__ == '__main__':
    unittest.main()
