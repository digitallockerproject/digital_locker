#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ "${1:-}" != "--free-plan-confirmed" ]; then
  echo "First check Billing: Free account plan, remaining credits, and expiry date."
  echo "Then run: ./deploy.sh --free-plan-confirmed"
  exit 1
fi
command -v sam >/dev/null || { echo 'Install the official AWS SAM CLI first.'; exit 1; }
command -v aws >/dev/null || { echo 'Install the official AWS CLI first.'; exit 1; }
aws sts get-caller-identity
sam validate --lint --region us-east-2
sam build --template-file template.yaml
sam deploy --guided --region us-east-2 --stack-name digital-locker-uploads \
  --parameter-overrides FreePlanConfirmed=yes
