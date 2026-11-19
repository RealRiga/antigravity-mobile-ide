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
2. **1-Click GitHub Repository Switcher & Privacy Obscure Mode**
   - Browse both public and private GitHub repositories (with Personal Access Token or local `gh` CLI).
   - Tap the **Eye icon** in the top bar to blur out repository names when coding in public spaces.
3. **GitHub-Style Explorer, Syntax-Highlighted Code Viewer & Image Previewer**
   - Hierarchical folder & breadcrumb navigation, single-pass multi-color syntax highlighting, unified diff viewer, and native image preview for PNG/JPG/JPEG/WEBP/GIF/SVG files.
4. **Mobile Drag-Down Pull-to-Refresh & Device-Default Theme**
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

## Cloud Deployment (Render.com Free Tier)

1. Connect this repository on Render.com (`render.yaml` + `Dockerfile`).
2. Set your environment variables (`GEMINI_API_KEY`, `AGY_ACCESS_PIN`, and optional `GITHUB_TOKEN` for private repos).
3. Keep the free tier awake 24/7 by pinging `https://<your-app>.onrender.com/health` every 10 minutes on `cron-job.org`.

## Documentation & License

- Full architecture guide: **[DOCS.md](DOCS.md)**
- Released under the **[MIT License](LICENSE)**.
