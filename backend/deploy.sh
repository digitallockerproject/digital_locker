#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ "${1:-}" != "--free-plan-confirmed" ]; then
  echo "First check Billing: Free account plan, remaining credits, and expiry date."
  echo "Then run: ./deploy.sh --free-plan-confirmed"
  exit 1
fi
[ -n "${SCANNER_IMAGE_URI:-}" ] || { echo 'Set SCANNER_IMAGE_URI to the built ECR image digest.'; exit 1; }
command -v sam >/dev/null || { echo 'Install the official AWS SAM CLI first.'; exit 1; }
command -v aws >/dev/null || { echo 'Install the official AWS CLI first.'; exit 1; }
aws sts get-caller-identity
sam validate --lint --region us-east-2
sam build --template-file template.yaml
sam deploy --guided --region us-east-2 --stack-name digital-locker-uploads \
  --image-repositories ScanFunction="${SCANNER_IMAGE_URI%@*}" \
  --parameter-overrides FreePlanConfirmed=yes ScannerImageUri="$SCANNER_IMAGE_URI"
