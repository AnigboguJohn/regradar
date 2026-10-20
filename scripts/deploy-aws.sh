#!/usr/bin/env bash
# One-command deploy to AWS. Needs: AWS CLI (configured with `aws configure`), Terraform, Docker, Node 22.
# Usage: ./scripts/deploy-aws.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TF=infra/terraform
[ -f $TF/terraform.tfvars ] || { echo "Copy $TF/terraform.tfvars.example to $TF/terraform.tfvars and fill it in."; exit 1; }

echo "==> 1/4 Creating infrastructure (first run takes ~15 minutes, mostly RDS + CloudFront)"
terraform -chdir=$TF init -input=false
terraform -chdir=$TF apply -input=false -auto-approve

out() { terraform -chdir=$TF output -raw "$1"; }
REGION=$(out region); ECR_API=$(out ecr_api); ECR_AI=$(out ecr_ai)
CLUSTER=$(out ecs_cluster); BUCKET=$(out web_bucket); CF=$(out cloudfront_id)
REGISTRY=${ECR_API%%/*}

echo "==> 2/4 Building and pushing containers"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker build --platform linux/amd64 -t "$ECR_API:latest" -f services/api/Dockerfile .
docker build --platform linux/amd64 -t "$ECR_AI:latest" services/ai
docker push "$ECR_API:latest"
docker push "$ECR_AI:latest"

echo "==> 3/4 Starting services"
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service ai  --force-new-deployment > /dev/null
aws ecs update-service --region "$REGION" --cluster "$CLUSTER" --service api --force-new-deployment > /dev/null

echo "==> 4/4 Publishing the web app"
(cd apps/web && npm install && npm run build)
aws s3 sync apps/web/dist "s3://$BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$CF" --paths "/*" > /dev/null

echo ""
echo "Done. Open: $(out app_url)   (give ECS ~3 minutes to start on the first deploy)"
echo "Admin console: $(out app_url)/admin"
echo "First deploy? Create your admin account with:"
echo "  ./scripts/admin-aws.sh create --email you@company.com --name \"Your Name\""
