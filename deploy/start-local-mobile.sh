#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/realriga/development/me/antigravity-mobile-ide"
cd "$PROJECT_DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

PORT="${PORT:-8000}"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")

echo "========================================================"
echo "🚀 Starting Antigravity Mobile IDE (Option 1: Local PC)"
echo "========================================================"
echo "📁 Workspace: ${AGY_WORKSPACE_DIR:-$PROJECT_DIR}"
echo "📱 Local Wi-Fi URL:   http://${LAN_IP}:${PORT}"
if [ -n "$TAILSCALE_IP" ]; then
  echo "🔒 Tailscale VPN URL: http://${TAILSCALE_IP}:${PORT}"
else
  echo "💡 Tip: Install Tailscale (https://tailscale.com) for 5G/remote access anywhere"
fi
echo "========================================================"

exec "$PROJECT_DIR/.venv/bin/python" -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"

