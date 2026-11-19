#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/realriga/development/me/antigravity-mobile-ide"
cd "$PROJECT_DIR"

SERVICE_NAME="${SERVICE_NAME:-antigravity-mobile-ide}"
REGION="${REGION:-us-central1}"
ACCESS_PIN="${AGY_ACCESS_PIN:-}"

if [ -z "$ACCESS_PIN" ]; then
  echo "⚠️  Set AGY_ACCESS_PIN before deploying to the public cloud so only you can access your IDE:"
  echo "   AGY_ACCESS_PIN=your-secret-pin ./deploy/deploy-cloudrun.sh"
  exit 1
fi

echo "🚀 Deploying $SERVICE_NAME to Google Cloud Run (Region: $REGION)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="AGY_ACCESS_PIN=${ACCESS_PIN},OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://localhost:11434},GEMINI_API_KEY=${GEMINI_API_KEY:-}"

