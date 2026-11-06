# Upload setup

Current status: deployed in us-east-2 and connected through the GitHub repository variable `VITE_DOCUMENT_API_URL`. Billing was checked after deployment: Free plan, $0.00 due, with a May 6, 2027 end date. The instructions below are for reproducing or maintaining the deployment.

The code is ready for deployment. Nothing in this package creates AWS resources until someone runs the deployment command. The AWS account owner can do that step without sharing a password or access keys.

## What this adds

- A file picker for PDF, PNG, and JPEG files, up to 5 MiB each.
- Private S3 storage with encryption and public access blocked.
- Document records in DynamoDB, separated by the signed-in user's Cognito ID.
- An API that checks sign-in before listing files or issuing upload/download links.
- Files that stay saved after refreshing or signing out.

The old sample documents, pretend scans, and demo sharing controls are removed from the active interface. Real uploads show **Not scanned**. This version does not scan for malware, share files publicly, delete files, or send notifications.

## 1. Check the account first

Use the AWS account that will own the upload storage and deploy in **us-east-2**. This can be separate from the account that owns the existing Cognito pool. The API checks tokens from that pool using its public issuer and signing keys; it does not need access to the other AWS account. Check Billing for the **Free account plan**, its expiry date, and remaining credits. Confirm that S3, Lambda, API Gateway HTTP APIs, DynamoDB provisioned capacity, CloudWatch Logs, and the deployment packaging bucket are available under that plan.

Do not switch to the Paid plan to complete this setup. If AWS asks for an upgrade or a required service is unavailable, stop. The app limits below reduce usage; they do not guarantee a $0 bill on a Paid plan. Other resources in the account also consume credits.

AWS's Free plan ends after six months or when its credits run out. Account resources become inaccessible when it ends. Download anything needed before then. This is a short-lived demo, not permanent free storage.

References:
- https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html
- https://aws.amazon.com/s3/pricing/

## 2. Deploy the backend (account owner)

Install the official AWS CLI and AWS SAM CLI if they are not already available:
- https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

Use your own normal AWS login or an existing authorized temporary session. Do not put AWS credentials in the website or send them to anyone.

From the project folder:

```sh
sh backend/deploy.sh --free-plan-confirmed
```

The script prints the account identity, validates and builds the template, then starts SAM's guided deployment. Confirm the printed account is correct. Use:

| Prompt | Setting |
| --- | --- |
| Stack | `digital-locker-uploads` |
| Region | `us-east-2` |
| FreePlanConfirmed | `yes`, only after checking Billing |
| WebOrigin | `https://digitallockerproject.github.io` |
| UserPoolId | `us-east-2_uFg6KbLXG` |
| ClientId | `4bm0b0hac4qikacbs3mtc88k5g` |
| Confirm changes before deploy | Yes |
| Allow SAM to create IAM roles | Yes, after reviewing the change set |
| Save arguments | Optional; keep `samconfig.toml` out of Git |

Review the final change set before approving it. It creates a private S3 bucket and policy, a DynamoDB table, an HTTP API and Cognito JWT authorizer, one Lambda function and its execution role, invoke permissions, and a seven-day log group. SAM also needs an S3 packaging bucket and a managed deployment stack if it has not created them before.

The Lambda role can read/write objects only under this new bucket's `private/` prefix and read/write this new table. It also has normal function logging permissions. It cannot administer Cognito or read unrelated buckets. The person deploying needs permission to create these resources through CloudFormation and pass the new execution role. The runtime role is not a deployment role. Do not give someone an administrator login just to run this.

If the owner prefers to grant deployment access rather than deploy personally, their AWS administrator should provide an authorized temporary role for this specific deployment. The exact deployer policy depends on the account's existing permission boundaries, service control policies, and CloudFormation setup; it cannot be safely finalized from the public repo alone.

At the end, copy the **ApiUrl** output. It is a public endpoint, not a secret. The owner only needs to give the project team that URL.

## 3. Connect the website

Merge this package's source files into the repo. It is based on commit `e1efbf3`; preserve any newer team changes. Do not upload `node_modules`, `dist`, temporary test pages, local credentials, or `.env` files.

In the GitHub repo, open **Settings → Secrets and variables → Actions → Variables**. Add a repository variable:

```text
Name: VITE_DOCUMENT_API_URL
Value: the ApiUrl from the deployment
```

Keep the value to the HTTPS origin, with no `/documents` suffix. This is a repository **variable**, not a password. The existing website deployment now reads it during the build.

Commit the source changes and run **Deploy Digital Locker** from Actions, or push the reviewed changes to `main`. Wait for the Pages deployment to finish, then reload the site. An empty API variable leaves the upload button disabled instead of pretending to save files.

For local development, copy `.env.example` to `.env` and set the URL. The deployed API only allows the production website origin. Local browser upload testing requires the owner to explicitly add the local origin to both API and S3 CORS rules first. The existing Cognito callback must also permit that local address. Keep the shipped production CORS restriction unless local testing is needed.

## 4. Check it after deployment

Use a harmless test PDF or image, not an ID, lease, or other personal document.

1. Sign in, upload a small file, and check that it appears as **Not scanned**.
2. Refresh and sign out/in. The record should remain.
3. Download it and compare it with the original.
4. Try an empty file, a file over 5 MiB, and an unsupported extension. They should be rejected.
5. Sign in as a second test user. The first user's documents must not appear.
6. Requests to the API without an access token must fail. An ID token must also fail.
7. Check Billing and the new resources after testing. Keep the account on the Free plan.

The backend was deployed and connected on November 6, 2026. A live browser PNG upload, persistence after refresh, an identical downloaded copy, and rejection of unsigned API requests were verified. A second-user isolation check and live oversized/unsupported-file checks are still available to run; automated tests cover those backend rules.

## Limits and cleanup

The backend reserves quota in one DynamoDB transaction before allowing each upload:

- 20 reservations per user.
- 100 reservations across the app.
- 100 MiB reserved across the app (also bounded per user).
- Signed POST uploads and download links expire after 60 seconds.
- Upload permissions constrain the object key, content type, encryption, and exact byte length.
- API request throttle: 2 requests/second, burst of 4. Throttling is best effort, not a billing cap.
- DynamoDB uses fixed provisioned capacity with no autoscaling.

Incomplete or invalid uploads keep their quota reservation. If a file transferred but confirmation failed, open its details and choose **Check upload**. If it never transferred, make a new upload. There is no automatic quota reset. The owner must review abandoned test records before doing any manual cleanup. Do not remove quota counters while leaving stored objects or document records behind.

A completed file can still be overwritten using the same upload permission until that permission expires. It is never labeled clean, and header validation is only a basic format check. Signed URLs are bearer permissions: anyone holding one can use it until it expires. They are not one-time links or public sharing with view limits.

The S3 bucket and table use `Retain` to avoid accidental data loss when the stack is deleted. Removing the stack does not remove those resources, their data, or SAM's packaging bucket. At the end of the demo, the owner should download any needed test files, stop using the app, remove the stack, and explicitly remove retained storage/records and unused packaging resources after review. Export the stack outputs first to keep track of their names.

No EC2 server, NAT gateway, paid malware service, custom KMS key, custom domain, database autoscaling, or background polling is added.
