# OwnStack Private Local IDE Chat Bridge

Sync your local IDE chats (**Antigravity IDE**, **Claude Code**, **Cursor**, **VS Code Cline/Roo**) directly into OwnStack IDE — **100% privately**.

## Why it's completely private
- Runs locally on **your own computer** (zero external Python dependencies).
- Protected by a personal secret token saved to `~/.ownstack_bridge_token` (`chmod 600`).
- OwnStack IDE connects **directly from your browser** to your bridge URL. The cloud server (Render/Railway) **never** sees, proxies, or stores your chats or token.
- Other users visiting the same OwnStack URL can run their own bridge on their own PC and connect their own IDE.

## Quick Start

1. Start the bridge on your PC:
   ```bash
   python3 bridge/ownstack_bridge.py
   ```
   Copy the **Bridge Token** printed in your terminal.

2. *(Optional, for phone/remote access over HTTPS)* Expose your local bridge privately with Cloudflare Tunnel or Tailscale:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8787
   ```

3. Open OwnStack IDE → **Agents & Config** (or tap **Sync IDE** in the Chat bar) → paste your **Bridge URL** and **Bridge Token** → tap **Sync IDE Chats**.

## Direct Browser Import (No Bridge Required)
Don't want to run a local bridge? Tap **Sync IDE** in the Chat bar and upload any `.jsonl` or `.json` transcript directly (e.g., Antigravity's `transcript.jsonl`, Claude Code `.jsonl`, or a JSON chat export). Files are parsed strictly inside your browser's `localStorage` and never uploaded to the server.
