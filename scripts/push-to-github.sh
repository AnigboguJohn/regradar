#!/usr/bin/env bash
# Publish this project to GitHub and switch on the live demo.
# Needs: git, and the GitHub CLI logged in (https://cli.github.com, then `gh auth login`).
# Usage: ./scripts/push-to-github.sh [repo-name]
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=${1:-regradar}
OWNER=$(gh api user --jq .login)

git init -q 2>/dev/null || true
git add -A
git commit -qm "RegRadar: real-time regulatory compliance assistant" || true
git branch -M main
gh repo create "$OWNER/$NAME" --public --source=. --remote=origin --push \
  --description "Real-time regulatory compliance assistant: RAG over regulator circulars with cited answers and policy impact analysis"
gh api -X POST "repos/$OWNER/$NAME/pages" -f build_type=workflow >/dev/null 2>&1 || true

echo ""
echo "Code:  https://github.com/$OWNER/$NAME"
echo "Demo:  https://$OWNER.github.io/$NAME/   (live about 2 minutes after the 'Demo on GitHub Pages' action finishes)"
