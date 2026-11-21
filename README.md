# OwnStack IDE — Multi-Agent Mobile & Desktop Development Environment

<p align="center">
  <img src="frontend/ownstack-banner.jpeg" alt="OwnStack IDE Banner" width="420" />
</p>

An open-source, mobile-first and desktop-ready AI Development Environment by **OwnStack** with dual-engine **Local AI (Ollama)** and **Cloud AI** multi-agent orchestration.

Work on your codebase from your phone (over Wi-Fi, 4G/5G via Tailscale, or 24/7 Cloud Hosting on Render) or from your desktop browser with autonomous coding agents, destructive-command approval gates, a 1-click GitHub repository switcher (public & private repos), a syntax-highlighted code & image viewer, and full Git source control.

---

## Key Features

1. **Dual-Engine Multi-Agent Runtime (`Local` ↔ `Cloud`)**
   - **1-Tap Engine Switcher**: Toggle instantly between **Local AI (Ollama)** and **Cloud AI** (+ autonomous subagents) right from the top header bar.
   - **Custom Agent Profiles**: Create unlimited specialized agent personas with custom models, instructions, and optional per-tool approval gates.
2. **Per-User Isolated GitHub Workspaces & Privacy Obscure Mode**
   - Every visitor gets their own isolated session workspace to connect their own GitHub username, Personal Access Token (browser-only), or direct Git URL.
   - Tap the **Eye icon** in the top bar to blur out repository names when coding in public spaces.
3. **Private Local IDE Chat Bridge & Direct Browser Import**
   - Sync per-project chats from **Antigravity IDE**, **Claude Code**, **Cursor**, and **VS Code (Cline/Roo)** directly from your PC to your browser using `bridge/ownstack_bridge.py` + `cloudflared`, or import `.jsonl`/`.json` transcripts client-side with zero server storage.
4. **GitHub-Style Explorer, Syntax-Highlighted Code Viewer & Image Previewer**
   - Hierarchical folder & breadcrumb navigation, single-pass multi-color syntax highlighting, unified diff viewer, and native image preview for PNG/JPG/JPEG/WEBP/GIF/SVG files.
5. **Mobile Drag-Down Pull-to-Refresh & Device-Default Theme**
   - Pull down on any view to refresh workspace data, with automatic OS Light/Dark theme detection and manual override toggle.

---

## Quick Start (Local PC)

```bash
cd /home/realriga/development/me/antigravity-mobile-ide

# 1. Create virtual environment & install dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Copy and configure .env
cp .env.example .env

# 3. Launch local server (prints Local Wi-Fi + Tailscale URLs)
./deploy/start-local-mobile.sh
```

## Sync Your Local IDE Chats (Antigravity, Claude Code, Cursor, VS Code)

```bash
# Terminal 1 — Start the private local IDE bridge (keeps Linux awake while locked)
systemd-inhibit --what=idle:sleep --who="OwnStack Bridge" --why="Syncing IDE chats" python3 bridge/ownstack_bridge.py

# Terminal 2 — Expose over HTTPS for mobile access
cloudflared tunnel --url http://127.0.0.1:8787
```

Paste the printed `https://....trycloudflare.com` URL and your `osb_...` Bridge Token into **⚡ IDE Sync** in OwnStack IDE. Press `Ctrl + C` in both terminals when done.

## Cloud Deployment (Render.com Free Tier)

1. Connect this repository on Render.com (`render.yaml` + `Dockerfile`).
2. Set your environment variables (`GEMINI_API_KEY`, `AGY_ACCESS_PIN`, `OLLAMA_BASE_URL`, `PORT`). Each visitor brings their own GitHub username/token in their browser.
3. Keep the free tier awake 24/7 by pinging `https://<your-app>.onrender.com/health` every 10 minutes on `cron-job.org`.

## Documentation & License

- Full architecture guide: **[DOCS.md](DOCS.md)**
- Released under the **[MIT License](LICENSE)**.
