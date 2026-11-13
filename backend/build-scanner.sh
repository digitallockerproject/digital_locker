#!/bin/sh
set -eu
cd "$(dirname "$0")"
region=us-east-2
account=$(aws sts get-caller-identity --query Account --output text)
repository=digital-locker-scanner
if ! aws ecr describe-repositories --repository-names "$repository" --region "$region" >/dev/null 2>&1; then
  aws ecr create-repository --repository-name "$repository" --image-tag-mutability IMMUTABLE --region "$region" >/dev/null
fi
registry="$account.dkr.ecr.$region.amazonaws.com"
tag="scan-$(date -u +%Y%m%d%H%M%S)"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"
docker build --platform linux/amd64 --provenance=false -t "$registry/$repository:$tag" scanner
docker push "$registry/$repository:$tag"
digest=$(aws ecr describe-images --repository-name "$repository" --image-ids imageTag="$tag" --region "$region" --query 'imageDetails[0].imageDigest' --output text)
printf '%s\n' "$registry/$repository@$digest" > scanner-image.txt
printf 'scanner image saved to backend/scanner-image.txt\n'
