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

## 2. Privacy & Security

- **Access PIN (`AGY_ACCESS_PIN`)**: Protects `/api/*` and `/ws/chat` when deployed to the cloud.
- **Public Privacy Mode**: Tapping the Eye icon blurs repository names and paths on-screen (`filter: blur(5px)`) so bystanders cannot read private project names.
- **Public Keep-Alive Endpoint**: `/health` returns `{"status": "awake"}` without exposing workspace data, allowing external cron monitors to keep cloud containers warm.

---

## 3. License

OwnStack IDE is open-source software licensed under the **MIT License** (`LICENSE`).
