# OwnStack IDE — Complete Architecture & Developer Guide (`DOCS.md`)

Welcome to the official documentation for **OwnStack IDE**. This guide explains how the frontend, backend, multi-agent runtime, file/image viewer, and GitHub workspace switcher work under the hood.

---

## 1. Architecture Overview

OwnStack IDE runs as a unified FastAPI + WebSocket server serving a responsive Progressive Web App (PWA):

- **Frontend (`frontend/index.html`, `frontend/styles.css`, `frontend/app.js`)**:
  - Single-row responsive header with OwnStack logo, active workspace pill, privacy eye blur toggle, `Local | Cloud` engine switcher, PIN lock, and device-default Light/Dark theme toggle.
  - Left IDE sidebar navigation rail (`Agent Chat`, `Explorer & Diff`, `GitHub Repos`, `Source Control`, `Agents & Config`, `Docs & Guide`).
  - Mobile drag-down pull-to-refresh across all views.
  - Single-pass syntax-highlighted code viewer, unified diff viewer, and native image previewer (`/api/files/raw`).
- **Backend (`backend/main.py`, `backend/agent_manager.py`, `backend/workspace_git.py`)**:
  - `MultiAgentOrchestrator`: Manages Local AI (Ollama), Cloud AI, and On-Device agent profiles, streaming WebSocket turns, and destructive-command approval gates.
  - `WorkspaceGitManager`: Safe workspace path resolution, file tree browsing, code reading/editing, unified diffs, Git CLI controls, and authenticated GitHub repo cloning.

---

## 2. Privacy, Session Isolation & Security

- **Per-User Workspace Isolation (`X-Session-ID`)**: Every browser gets its own isolated workspace directory on the server. Visitors never share folders, active repos, or agent history, and cannot traverse outside their own session directory.
- **Bring Your Own GitHub Repo (Zero Server Credentials)**: No hardcoded GitHub username or server-side `GITHUB_TOKEN` / `gh` CLI fallback. Each visitor connects their own GitHub username, pastes their own Personal Access Token (stored strictly in their browser's `localStorage`), or clones any Git URL directly.
- **Access PIN (`AGY_ACCESS_PIN`)**: Protects `/api/*` and `/ws/chat` when deployed to the cloud (can be toggled live in **Agents & Config**).
- **Public Privacy Mode**: Tapping the Eye icon blurs repository names and paths on-screen (`filter: blur(5px)`) so bystanders cannot read private project names.
- **Public Keep-Alive Endpoint**: `/health` returns `{"status": "awake"}` without exposing workspace data, allowing external cron monitors to keep cloud containers warm.

---

## 3. Private Local IDE Chat Bridge & Browser Import

Sync your desktop IDE chats (**Antigravity IDE**, **Claude Code**, **Cursor**, **VS Code Cline/Roo**) directly into OwnStack IDE — **100% privately**. Your browser connects directly to your own PC bridge; the hosted server never sees, proxies, or stores your IDE chats or bridge token.

### Run the Bridge on Your PC (Live Sync)

1. **Terminal 1 — Start the bridge** (use `systemd-inhibit` on Linux so your laptop stays awake while locked):
   ```bash
   systemd-inhibit --what=idle:sleep --who="OwnStack Bridge" --why="Syncing IDE chats" python3 bridge/ownstack_bridge.py
   ```
   *(On macOS/Windows or without sleep-inhibit, run `python3 bridge/ownstack_bridge.py`.)*
   Copy the **`Bridge Token`** (`osb_...`) printed in the terminal.

2. **Terminal 2 — Expose over HTTPS for mobile access** (Cloudflare Quick Tunnel):
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8787
   ```
   Copy the printed `https://....trycloudflare.com` URL.

3. **Connect in OwnStack IDE**:
   - Tap **⚡ IDE Sync** in the **Agent Chat** bar (or **Agents & Config → ⚡ Connect My IDE**).
   - Paste your **Bridge URL** and **Bridge Token**, choose your IDE & project scope, and tap **Sync Chats From My IDE**.
   - When you return to your PC, press **`Ctrl + C`** in both terminals to stop the tunnel and bridge. Already-synced chats remain cached in your browser's `localStorage`.

### Direct Browser Import (Zero Setup)

Tap **⚡ IDE Sync → 2. Direct Browser Import** to select local `.jsonl` or `.json` chat files (e.g. Antigravity `transcript.jsonl`, Claude Code `.jsonl`, or JSON chat exports). Files are parsed 100% client-side into your browser and never uploaded to the server.

---

## 4. License

OwnStack IDE is open-source software licensed under the **MIT License** (`LICENSE`).
