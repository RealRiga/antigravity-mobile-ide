# OwnStack Antigravity IDE — Complete Architecture & User Guide (`DOCS.md`)

Welcome to the official documentation for **OwnStack Antigravity IDE**. This document explains how every piece of the system works under the hood so developers and contributors can use, customize, and extend the platform.

---

## 1. High-Level Architecture

OwnStack Antigravity IDE is split into two clean layers served from a single FastAPI process (making it effortless to run locally or deploy as a single Docker container):

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                   CLIENT (Desktop & Mobile PWA)                         │
│  frontend/index.html  •  frontend/styles.css  •  frontend/app.js        │
│                                                                         │
│  • Welcome & Get Started Onboarding   • 1-Tap Ollama <-> Gemini Toggle  │
│  • Left IDE Sidebar Activity Rail     • Native <dialog> Approval Gates  │
│  • 1-Click GitHub Repo Switcher       • Split-Screen Code & Diff Editor │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │ HTTPS REST + X-AGY-PIN          │ WebSocket (/ws/chat)
                    ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   FASTAPI BACKEND (backend/main.py)                     │
│                                                                         │
│  ┌───────────────────────────────────┐ ┌──────────────────────────────┐ │
│  │ MultiAgentOrchestrator            │ │ WorkspaceGitManager          │ │
│  │ (backend/agent_manager.py)        │ │ (backend/workspace_git.py)   │ │
│  │                                   │ │                              │ │
│  │ • Google Antigravity Python SDK   │ │ • Safe File Tree Traversal   │ │
│  │ • Ollama: LocalOpenAIAgentConfig  │ │ • Code Reader & Writer       │ │
│  │ • Gemini: LocalAgentConfig        │ │ • Unified Diff Generator     │ │
│  │ • LiteRT: LiteRTAgentConfig       │ │ • Git Status/Branch/Commit   │ │
│  │ • Subagents & Approval Gate Hooks │ │ • Remote GitHub Repo Cloner  │ │
│  └───────────────────────────────────┘ └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. How Multi-Agent Profiles Work (`backend/agent_manager.py`)

Every agent in the IDE is represented by an `AgentProfile` object. When you send a chat message, `MultiAgentOrchestrator._build_sdk_config()` compiles that profile into an official **Google Antigravity SDK** configuration:

### A. Ollama Agents (`LocalOpenAIAgentConfig`)
- Connects to any local or remote Ollama server (`http://localhost:11434/v1` or a Tailscale IP like `http://100.x.y.z:11434/v1`).
- Calls `.lightweight()` automatically, which trims system prompt overhead, configures context compaction for local KV-caches, and enables core coding tools (`view_file`, `edit_file`, `create_file`, `run_command`).
- Requires **zero API keys**.

### B. Gemini Agents (`LocalAgentConfig` + `SubagentConfig`)
- Connects to Google's Gemini models using `GEMINI_API_KEY`.
- Automatically detects both:
  - **Standard Google AI Studio keys (`AIzaSy...`)**
  - **Vertex AI / Agent Platform Express Mode keys (`AQ....`)** by passing `vertex=True`.
- Configures hierarchical subagents (`code_researcher`, `fact_checker`, `test_specialist`) with `max_subagent_depth=3`, allowing the lead agent to spawn autonomous helpers to explore files and verify changes.

### C. LiteRT On-Device Agents (`LiteRTAgentConfig`)
- Runs `.litertlm` model checkpoints (such as Gemma 4 26B) directly on your machine's GPU or NPU via Google's LiteRT runtime.

---

## 3. How Mobile Tool Approval Gates Work

To keep your codebase safe when an autonomous agent wants to run a shell command or modify a file:

1.Each `AgentProfile` defines `require_approval_for` (by default `["run_command", "edit_file", "create_file"]`).
2. `MultiAgentOrchestrator` attaches two layers of defense using the Antigravity SDK:
   - Declarative policies: `policy.workspace_only([workspace_dir])` and `policy.ask_user(tool_name, handler=...)`
   - Lifecycle hooks: `@hooks.pre_tool_call_decide` and `@hooks.post_tool_call`
3. When an agent invokes a gated tool:
   - The backend creates an `asyncio.Future` stored in `pending_approvals[approval_id]` and sends an `approval_required` event over the `/ws/chat` WebSocket.
   - The frontend immediately pops open the native `<dialog id="approval-dialog">` showing the agent name, tool name, and exact JSON arguments.
   - Execution pauses until you tap **Approve & Run** or **Deny** on your phone or PC.

---

## 4. How the GitHub Repository Browser & Workspace Switcher Works

In the **GitHub Repos (`<>`)** tab on the left sidebar:
1. Calling `GET /api/github/repos?username=RealRiga` queries the GitHub REST API for your latest repositories (and supports an optional Personal Access Token for private repos).
2. Clicking **"Open in IDE →"** on any repository calls `POST /api/git/clone`, which clones the repository into the workspace folder and dynamically switches both `orchestrator.workspace_dir` and `git_manager.workspace_dir` into that repository.
3. You can also switch between already-cloned local folders in `/home/realriga/development/me` with a single click under **Active & Local Workspaces**.

---

## 5. How Security & `AGY_ACCESS_PIN` Work

When deployed to the cloud (e.g., Render.com):
- Setting `AGY_ACCESS_PIN` in the server environment activates the `pin_auth_middleware` in `backend/main.py`.
- Every `/api/*` request must include the `X-AGY-PIN` header, and `/ws/chat` requires `?pin=<PIN>`.
- If the PIN is missing or invalid, the frontend automatically detects `pin_required: true` (or `401 Unauthorized`) and opens the **Unlock OwnStack Workspace** modal so you can enter your PIN once (saved in `localStorage`).
- The public `/health` and `/ping` endpoints remain intentionally open (returning `{"status": "awake"}`) so external uptime monitors like **cron-job.org** can ping your Render container every 10 minutes without needing your secret PIN.

---

## 6. Directory & File Reference

| File / Path | Purpose |
| :--- | :--- |
| `backend/main.py` | FastAPI application, PIN middleware, REST endpoints (`/api/agents`, `/api/files`, `/api/git/*`, `/api/github/repos`, `/health`), and `/ws/chat` WebSocket server. |
| `backend/agent_manager.py` | `MultiAgentOrchestrator` managing Ollama, Gemini, and LiteRT agent profiles, subagents, streaming thoughts/tokens, and async mobile approval gates. |
| `backend/workspace_git.py` | `WorkspaceGitManager` handling safe file tree browsing, file reading/writing, unified diff generation, `git` CLI operations, and remote repo cloning. |
| `frontend/index.html` | Single-page application shell with the Welcome onboarding view, left IDE sidebar rail, chat canvas, split-screen file/diff explorer, GitHub repo browser, and native `<dialog>` modals. |
| `frontend/styles.css` | CSS design system with `light-dark()` tokens, pure white default theme, dark mode override rules, and scroll-contained modal dialogs. |
| `frontend/app.js` | Client-side state controller, WebSocket streaming renderer, Enter-to-send handler, theme toggle, engine switcher, and GitHub workspace switcher. |
| `deploy/start-local-mobile.sh` | 1-command local PC launcher that loads `.env` and prints Local Wi-Fi + Tailscale mobile URLs. |
| `deploy/antigravity-mobile.service` | `systemd` user service unit for auto-starting the IDE on Linux boot. |
| `Dockerfile` & `render.yaml` | Production container image and Render Free Tier blueprint configuration. |
| `LICENSE` | Open-source MIT License. |
