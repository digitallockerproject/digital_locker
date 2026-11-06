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
2. API Gateway verifies the token. The function checks that it is an access token for our app, reserves storage quota, and returns a short-lived S3 upload form.
3. The browser sends the file directly to the private S3 bucket.
4. The API checks that the file arrived with the expected size and a matching format header, then saves its status as **Not scanned**.
5. Listing and downloading use the signed-in user's ID. Download links last 60 seconds.

There is no malware scanning, public sharing, file deletion, or account editing in this version. The header check is not a scan. The original demo-only table and seed-data exports are left in the repo for reference but are not used for live document state.

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

The tests mock AWS calls; they do not create cloud resources or prove that a particular AWS account will allow deployment. The frontend build, 6 frontend request tests, and 16 backend tests pass, and the template passes cfn-lint. A live browser upload, page refresh, and matching download were verified on November 6, 2026. The API also rejected unsigned requests.

## Current limits

Files can be PDF, PNG, or JPEG, up to 5 MiB each. The app allows 20 upload reservations per user, 100 across the app, and 100 MiB reserved storage total. Failed uploads keep their reservation. Files are not automatically deleted.

The AWS account remains on the Free plan, which ends May 6, 2027 or when its credits run out. The S3 bucket and DynamoDB table are retained if the backend stack is removed.
