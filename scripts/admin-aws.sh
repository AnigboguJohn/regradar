#!/usr/bin/env bash
# Manage platform admin accounts on the AWS deployment by running the admin tool as a one-off
# ECS task (same image and secrets as the API), then printing its output from CloudWatch.
#
# Usage (after ./scripts/deploy-aws.sh):
#   ./scripts/admin-aws.sh create --email you@company.com --name "Your Name"
#   ./scripts/admin-aws.sh reset-password --email you@company.com
#   ./scripts/admin-aws.sh reset-2fa --email you@company.com
#   ./scripts/admin-aws.sh disable --email someone@company.com
#   ./scripts/admin-aws.sh list
#
# Locally (docker compose), run the same tool directly instead:
#   docker compose exec api node dist/cli/admin.js create --email you@company.com --name "Your Name"
set -euo pipefail
cd "$(dirname "$0")/.."
[ $# -ge 1 ] || { sed -n 5,10p "$0"; exit 1; }

TF=infra/terraform
out() { terraform -chdir=$TF output -raw "$1"; }
REGION=$(out region); CLUSTER=$(out ecs_cluster); TASKDEF=$(out api_task_definition)
SUBNETS=$(out api_subnets); SG=$(out api_security_group)

# Build the container command as JSON: ["node","dist/cli/admin.js", ...your arguments].
CMD=$(node -e 'console.log(JSON.stringify(["node", "dist/cli/admin.js", ...process.argv.slice(1)]))' "$@")

echo "==> Starting a one-off task on $CLUSTER"
TASK_ARN=$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$TASKDEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"api\",\"command\":$CMD}]}" \
  --query 'tasks[0].taskArn' --output text)

echo "==> Waiting for it to finish (usually under a minute)"
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"

LOG_GROUP=$(aws ecs describe-task-definition --region "$REGION" --task-definition "$TASKDEF" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)
aws logs get-log-events --region "$REGION" --log-group-name "$LOG_GROUP" \
  --log-stream-name "app/api/${TASK_ARN##*/}" --query 'events[].message' --output text | tr '\t' '\n' | grep -v '"level"' || true

EXIT=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)
[ "$EXIT" = "0" ] || { echo "The admin tool exited with code $EXIT"; exit 1; }
