# Digital Locker

A React/Vite document locker with Cognito sign-in and private AWS uploads.

## Run locally

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev
```

The local address is `http://127.0.0.1:5173/digital_locker/`. Sign-in settings are in [AUTH_SETUP.md](AUTH_SETUP.md).

Uploads are deployed in us-east-2 and connected through the GitHub repository variable `VITE_DOCUMENT_API_URL`. The website starts with an empty locker for each user. For local development, copy `.env.example` to `.env` and set the API address; browser requests also need an allowed origin in the API and bucket CORS settings.

```sh
npm run build
node --test tests/document-api.test.mjs
```

## How uploads work

1. The browser sends the filename, size, and category to the API with its Cognito access token.
2. API Gateway verifies the token. The function checks that it is an access token for our app, reserves storage quota, and returns a short-lived S3 upload URL. The signed PUT includes the exact content length and an `If-None-Match` header so it cannot overwrite a saved file.
3. The browser sends the file directly to the private S3 bucket.
4. The API checks that the file arrived with the expected size and a matching format header, then reads the ClamAV scan result. Missing, failed, skipped, or flagged scans block downloads.
5. Listing and downloading use the signed-in user's ID. Download links last 60 seconds and are issued only after checking the current scan tag.

New uploads are scanned by ClamAV in a separate Lambda container, triggered through S3 and EventBridge. Files remain in this AWS account; the scanner only downloads public signature definitions from ClamAV. It checks definitions on cold start and refreshes its temporary cache after 24 hours. If definitions cannot be downloaded, the file stays blocked. The app shows scanning, clean, flagged, or unavailable results and checks pending scans automatically for up to five minutes. Use Refresh or Check status afterward. A clean result means no threats were detected; it is not a guarantee that a file is safe. Older uploads without a scan result must be uploaded again. GuardDuty is not used because this Free plan account blocks it.

You can permanently delete your own documents from their details after a five-minute wait. A failed deletion stays locked and can be retried. Upload reservations are retained after deletion to limit cumulative scan usage. No automatic deletion is configured. Account editing remains out of scope.

## Files

- `src/App.jsx`: document screens and upload form.
- `src/document-api.js`: requests and direct S3 uploads.
- `src/auth-config.js`: existing Cognito sign-in settings.
- `backend/app.py`: upload, list, confirmation, and download endpoints.
- `backend/template.yaml`: AWS resources and runtime permissions.

## Backend checks

Use a separate Python environment:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/python -m unittest discover -s backend/tests -v
AWS_DEFAULT_REGION=us-east-2 AWS_EC2_METADATA_DISABLED=true .venv/bin/cfn-lint backend/template.yaml
```

The tests mock AWS calls; they do not create cloud resources or prove that a particular AWS account will allow deployment. The frontend build, frontend request tests, backend tests, and CloudFormation lint are checked before release. The scan tests cover blocked downloads, missing and failed scans, owner isolation, and retryable deletion. A live browser upload, page refresh, and matching download were verified on November 6, 2026; the new scanning flow requires a fresh deployment and live verification. The API also rejected unsigned requests.

## Current limits

Files can be PDF, PNG, or JPEG, up to 5 MiB each. The app allows 20 upload reservations per user, 100 across the app, and 100 MiB reserved storage total. Failed uploads keep their reservation. Files are not automatically deleted.

The AWS account remains on the Free plan, which ends May 6, 2027 or when its credits run out. The S3 bucket and DynamoDB table are retained if the backend stack is removed.

## Scan usage

The scanner uses Lambda, EventBridge, and a small ECR image within the existing Free account plan; there is no paid security subscription or running server. Normal AWS usage can consume promotional credits. The app keeps its existing lifetime cap of 100 upload reservations and 100 MiB total; deleting files does not reset it. Direct uploads by an AWS administrator are outside these app limits. Scan execution is bounded to five minutes at 2 GiB memory, with no Lambda function-error retries. Each new Lambda environment downloads ClamAV definitions; failed or delayed scans keep downloads blocked.

The Free plan is time-limited. Do not upgrade it to Paid for this demo. See [AWS supported services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html). The stack adds a bucket-scoped scanner role and the API's permission to read scan tags and delete its private files. The container must be built in us-east-2 ECR and passed to the stack by its digest using `ScannerImageUri`.

## Share links

Only clean-scanned files can be shared. Owners choose 15 minutes, 1 hour, 1 day, or 7 days and 1–10 link uses. They can view usage and revoke links from Document details → Share document. Creating links has a lifetime demo cap of 20 per user and 100 total, including revoked and expired links.

The 256-bit random link secret is shown once and stored only as a SHA-256 hash in DynamoDB. It travels in the website URL fragment; the landing page removes it from the address bar and does not redeem until the recipient clicks Download. The public endpoint checks expiry, revocation, current scan status, and document existence. A conditional DynamoDB update reserves each use atomically. GET requests do not redeem links.

A use means issuing a download URL, not proving that the transfer finished. Failed or interrupted requests may consume a use. Issued URLs last at most 15 seconds, capped by the link expiry; revocation cannot cancel a URL already issued during that brief interval. Copies already downloaded cannot be recalled or prevented from being shared again. The underlying S3 bucket stays private.
