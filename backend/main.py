"""
FastAPI Backend for OwnStack (Antigravity Mobile Companion).

Exposes:
- `/ws/chat` WebSocket for real-time agent streaming (thoughts, tools, tokens, and mobile approval gates)
- `/api/agents` CRUD for Multi-Agent profiles (Ollama, Gemini + Subagents, LiteRT)
- `/api/ollama/status` Live probe for local/remote Ollama models
- `/api/approvals/{approval_id}` REST endpoint for resolving mobile tool approvals
- `/api/files` File tree explorer, code reader, file writer, and diff inspection
- `/api/git/*` Git status, unified diff, branch checkout/creation, staging, and commit
- Per-user isolated workspaces keyed by `X-Session-ID` (never exposes server/owner repos or tokens)
- Static PWA frontend hosting at `/`
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.agent_manager import HAS_AGY_SDK, MultiAgentOrchestrator
from backend.workspace_git import WorkspaceGitManager

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
SESSIONS_ROOT = os.path.abspath(
    os.environ.get("AGY_SESSIONS_DIR", os.path.join(tempfile.gettempdir(), "ownstack_sessions"))
)
os.makedirs(SESSIONS_ROOT, exist_ok=True)

# Runtime toggle for PIN Lock (Can be toggled ON/OFF live from Agents & Config!)
PIN_LOCK_ENABLED = bool(os.environ.get("AGY_ACCESS_PIN", "").strip())

app = FastAPI(
    title="OwnStack IDE API",
    description="OwnStack Multi-Agent Mobile & Desktop IDE",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass
class UserSession:
    session_id: str
    session_root: str
    orchestrator: MultiAgentOrchestrator
    git_manager: WorkspaceGitManager

    @property
    def has_repo(self) -> bool:
        ws = self.git_manager.workspace_dir
        if os.path.isdir(os.path.join(ws, ".git")):
            return True
        if os.path.basename(ws) != "workspace":
            return True
        try:
            return len(os.listdir(ws)) > 0
        except OSError:
            return False

    @property
    def workspace_name(self) -> str:
        if not self.has_repo:
            return ""
        return os.path.basename(self.git_manager.workspace_dir)


_sessions: Dict[str, UserSession] = {}


def _sanitize_session_id(raw: Optional[str]) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", (raw or "").strip())[:64]
    return cleaned or "anon"


def get_session_by_id(raw_session_id: Optional[str]) -> UserSession:
    sid = _sanitize_session_id(raw_session_id)
    if sid in _sessions:
        return _sessions[sid]

    session_root = os.path.abspath(os.path.join(SESSIONS_ROOT, sid))
    os.makedirs(session_root, exist_ok=True)

    # Default to an isolated empty workspace; if this session already cloned a repo on disk, restore it
    initial_ws = os.path.join(session_root, "workspace")
    os.makedirs(initial_ws, exist_ok=True)
    for entry in sorted(os.listdir(session_root)):
        full = os.path.join(session_root, entry)
        if entry != "workspace" and os.path.isdir(full) and os.path.isdir(os.path.join(full, ".git")):
            initial_ws = full
            break

    sess = UserSession(
        session_id=sid,
        session_root=session_root,
        orchestrator=MultiAgentOrchestrator(workspace_dir=initial_ws),
        git_manager=WorkspaceGitManager(workspace_dir=initial_ws),
    )
    _sessions[sid] = sess
    return sess


def get_session(request: Request) -> UserSession:
    raw = (
        request.headers.get("X-Session-ID")
        or request.query_params.get("session_id")
        or ""
    )
    return get_session_by_id(raw)


@app.middleware("http")
async def pin_auth_middleware(request: Request, call_next):
    """Protects /api/* routes when PIN_LOCK_ENABLED is True and AGY_ACCESS_PIN is configured."""
    active_pin = os.environ.get("AGY_ACCESS_PIN", "").strip()
    # Allow public uptime monitors (cron-job.org / UptimeRobot) to ping /health without a PIN
    if request.url.path in ("/health", "/ping"):
        return await call_next(request)
    if PIN_LOCK_ENABLED and active_pin and request.url.path.startswith("/api/"):
        client_pin = (
            request.headers.get("X-AGY-PIN")
            or request.query_params.get("pin")
            or ""
        ).strip()
        if client_pin != active_pin:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing AGY_ACCESS_PIN. Enter your PIN in OwnStack IDE."},
            )
    return await call_next(request)


@app.get("/health")
@app.get("/ping")
async def public_cron_health() -> Dict[str, Any]:
    """Lightweight public health check for Render & external cron jobs (cron-job.org, UptimeRobot)."""
    active_pin = os.environ.get("AGY_ACCESS_PIN", "").strip()
    return {
        "status": "awake",
        "service": "ownstack-ide",
        "pin_required": bool(PIN_LOCK_ENABLED and active_pin),
    }


@app.get("/api/github/repos")
async def list_github_repos(
    request: Request,
    username: str = "",
    token: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetches GitHub repositories strictly for the visitor-supplied username or X-GitHub-Token."""
    session = get_session(request)
    clean_user = username.strip().lstrip("@")
    # Strictly use visitor-provided token only — never fall back to server GITHUB_TOKEN or local `gh` CLI
    gh_token = (request.headers.get("X-GitHub-Token") or token or "").strip()

    if not gh_token and not clean_user:
        return {
            "username": "",
            "authenticated": False,
            "total": 0,
            "active_workspace": session.workspace_name,
            "repos": [],
            "needs_setup": True,
        }

    headers = {"Accept": "application/vnd.github+json", "User-Agent": "OwnStack-IDE"}
    if gh_token:
        headers["Authorization"] = f"Bearer {gh_token}"
        base_url = "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member"
    else:
        base_url = f"https://api.github.com/users/{clean_user}/repos?sort=updated&per_page=100"

    repos: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Paginate up to 5 pages (up to 500 repositories)
            for page in range(1, 6):
                resp = await client.get(f"{base_url}&page={page}", headers=headers)
                if resp.status_code != 200:
                    if page == 1:
                        return {
                            "username": clean_user,
                            "repos": [],
                            "authenticated": bool(gh_token),
                            "error": f"GitHub API returned {resp.status_code}",
                        }
                    break
                batch = resp.json()
                if not isinstance(batch, list) or len(batch) == 0:
                    break
                for r in batch:
                    if isinstance(r, dict):
                        repos.append(
                            {
                                "name": r.get("name"),
                                "full_name": r.get("full_name"),
                                "description": r.get("description") or "No description",
                                "clone_url": r.get("clone_url"),
                                "html_url": r.get("html_url"),
                                "language": r.get("language") or "Code",
                                "updated_at": r.get("updated_at", "")[:10],
                                "private": bool(r.get("private", False)),
                            }
                        )
                if len(batch) < 100:
                    break

        return {
            "username": clean_user,
            "authenticated": bool(gh_token),
            "total": len(repos),
            "active_workspace": session.workspace_name,
            "repos": repos,
            "needs_setup": False,
        }
    except Exception as exc:
        return {"username": clean_user, "repos": [], "authenticated": bool(gh_token), "error": str(exc)}


@app.get("/api/workspaces")
async def list_local_workspaces(request: Request) -> Dict[str, Any]:
    """Lists ONLY repositories cloned inside this visitor's isolated session directory."""
    session = get_session(request)
    workspaces: List[Dict[str, Any]] = []
    if os.path.isdir(session.session_root):
        for entry in sorted(os.listdir(session.session_root)):
            full = os.path.join(session.session_root, entry)
            if not os.path.isdir(full) or entry.startswith("."):
                continue
            is_git = os.path.isdir(os.path.join(full, ".git"))
            # Hide the default empty placeholder folder unless the user actually created files in it
            if entry == "workspace" and not is_git:
                try:
                    if len(os.listdir(full)) == 0:
                        continue
                except OSError:
                    continue
            workspaces.append(
                {
                    "name": entry,
                    "path": full,
                    "active": os.path.abspath(full) == os.path.abspath(session.git_manager.workspace_dir),
                    "is_git": is_git,
                }
            )
    return {
        "active_workspace": session.git_manager.workspace_dir if session.has_repo else "",
        "workspace_name": session.workspace_name,
        "has_repo": session.has_repo,
        "workspaces": workspaces,
    }


class AgentProfilePayload(BaseModel):
    id: Optional[str] = None
    name: str
    role: str = "Autonomous Coding Agent"
    provider: str = "ollama"  # "ollama" | "gemini" | "litert"
    model: str = "gemma4:26b"
    base_url: str = "http://localhost:11434/v1"
    system_instructions: str = ""
    require_approval_for: List[str] = ["run_command", "edit_file", "create_file"]
    enable_subagents: bool = False
    max_subagent_depth: int = 2
    subagents: List[Dict[str, Any]] = []
    use_lightweight: bool = True
    enable_sandbox: bool = False


class ApprovalDecisionPayload(BaseModel):
    approved: bool


class FileSavePayload(BaseModel):
    path: str
    content: str


class GitCommitPayload(BaseModel):
    message: str


class GitBranchPayload(BaseModel):
    branch: str
    create: bool = False


class GitClonePayload(BaseModel):
    repo_url: str
    folder_name: Optional[str] = None
    token: Optional[str] = None


class RuntimeSettingsPayload(BaseModel):
    ollama_base_url: Optional[str] = None
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    workspace_dir: Optional[str] = None
    pin_lock_enabled: Optional[bool] = None


class CheckpointCreatePayload(BaseModel):
    label: str = "prompt-checkpoint"


class CheckpointRestorePayload(BaseModel):
    tree_sha: str


@app.get("/api/health")
async def get_health(request: Request) -> Dict[str, Any]:
    session = get_session(request)
    orchestrator = session.orchestrator
    ollama_info = await orchestrator.check_ollama_status()
    active_pin = os.environ.get("AGY_ACCESS_PIN", "").strip()
    return {
        "status": "ok",
        "has_agy_sdk": HAS_AGY_SDK,
        "workspace_dir": orchestrator.workspace_dir if session.has_repo else "",
        "workspace_name": session.workspace_name,
        "has_repo": session.has_repo,
        "ollama": ollama_info,
        "has_gemini_key": bool(orchestrator.gemini_api_key or os.environ.get("GEMINI_API_KEY")),
        "has_openai_key": bool(orchestrator.openai_api_key or os.environ.get("OPENAI_API_KEY")),
        "openai_base_url": orchestrator.openai_base_url,
        "openai_model": orchestrator.openai_model,
        "pin_lock_enabled": bool(PIN_LOCK_ENABLED and active_pin),
        "has_pin_configured": bool(active_pin),
    }


@app.post("/api/settings")
async def update_settings(request: Request, payload: RuntimeSettingsPayload) -> Dict[str, Any]:
    global PIN_LOCK_ENABLED
    session = get_session(request)
    orchestrator = session.orchestrator
    git_manager = session.git_manager

    if payload.pin_lock_enabled is not None:
        PIN_LOCK_ENABLED = bool(payload.pin_lock_enabled)
    if payload.ollama_base_url:
        orchestrator.ollama_base_url = payload.ollama_base_url.strip()
        for p in orchestrator.profiles.values():
            if p.provider == "ollama":
                base = orchestrator.ollama_base_url.rstrip("/")
                p.base_url = base if base.endswith("/v1") else f"{base}/v1"
    if payload.gemini_api_key is not None:
        orchestrator.gemini_api_key = payload.gemini_api_key.strip()
    if payload.openai_api_key is not None:
        orchestrator.openai_api_key = payload.openai_api_key.strip()
    if payload.openai_base_url:
        orchestrator.openai_base_url = payload.openai_base_url.strip()
    if payload.openai_model:
        orchestrator.openai_model = payload.openai_model.strip()
    if payload.workspace_dir and os.path.isdir(payload.workspace_dir):
        abs_ws = os.path.abspath(payload.workspace_dir)
        # Enforce strict session boundary: visitors can only switch to folders inside their own session
        try:
            if os.path.commonpath([session.session_root, abs_ws]) == session.session_root:
                orchestrator.workspace_dir = abs_ws
                git_manager.workspace_dir = abs_ws
        except ValueError:
            pass

    return await get_health(request)


@app.post("/api/checkpoints/create")
async def create_workspace_checkpoint(request: Request, payload: CheckpointCreatePayload) -> Dict[str, Any]:
    session = get_session(request)
    return session.git_manager.create_checkpoint(payload.label)


@app.post("/api/checkpoints/restore")
async def restore_workspace_checkpoint(request: Request, payload: CheckpointRestorePayload) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.restore_checkpoint(payload.tree_sha)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/ollama/status")
async def get_ollama_status(request: Request, base_url: Optional[str] = None) -> Dict[str, Any]:
    session = get_session(request)
    return await session.orchestrator.check_ollama_status(base_url)


@app.get("/api/agents")
async def list_agents(request: Request) -> Dict[str, Any]:
    session = get_session(request)
    return {"agents": session.orchestrator.list_profiles()}


@app.post("/api/agents")
async def create_or_update_agent(request: Request, payload: AgentProfilePayload) -> Dict[str, Any]:
    session = get_session(request)
    profile = session.orchestrator.add_or_update_profile(payload.model_dump())
    return {"agent": profile, "agents": session.orchestrator.list_profiles()}


@app.delete("/api/agents/{agent_id}")
async def delete_agent(request: Request, agent_id: str) -> Dict[str, Any]:
    session = get_session(request)
    deleted = session.orchestrator.delete_profile(agent_id)
    if not deleted:
        raise HTTPException(status_code=400, detail="Could not delete agent profile.")
    return {"deleted": True, "agents": session.orchestrator.list_profiles()}


@app.get("/api/agents/{agent_id}/history")
async def get_agent_history(request: Request, agent_id: str) -> Dict[str, Any]:
    session = get_session(request)
    return {
        "agent_id": agent_id,
        "history": session.orchestrator.conversation_history.get(agent_id, []),
    }


@app.post("/api/approvals/{approval_id}")
async def decide_approval(request: Request, approval_id: str, payload: ApprovalDecisionPayload) -> Dict[str, Any]:
    session = get_session(request)
    resolved = session.orchestrator.resolve_approval(approval_id, payload.approved)
    return {"approval_id": approval_id, "resolved": resolved, "approved": payload.approved}


@app.get("/api/files")
async def list_files(request: Request) -> Dict[str, Any]:
    session = get_session(request)
    return {
        "workspace_dir": session.git_manager.workspace_dir if session.has_repo else "",
        "has_repo": session.has_repo,
        "files": session.git_manager.list_file_tree(),
    }


@app.get("/api/docs")
async def get_project_docs() -> Dict[str, str]:
    """Returns both DOCS.md and README.md so users can read complete project documentation inside the app."""
    docs_path = os.path.join(PROJECT_ROOT, "DOCS.md")
    readme_path = os.path.join(PROJECT_ROOT, "README.md")
    docs_text = ""
    readme_text = ""
    if os.path.isfile(docs_path):
        with open(docs_path, "r", encoding="utf-8") as f:
            docs_text = f.read()
    if os.path.isfile(readme_path):
        with open(readme_path, "r", encoding="utf-8") as f:
            readme_text = f.read()
    return {"docs": docs_text, "readme": readme_text}


@app.get("/api/files/read")
async def read_workspace_file(request: Request, path: str) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.read_file(path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/files/raw")
async def read_raw_workspace_file(request: Request, path: str) -> FileResponse:
    """Serves raw binary/image files (PNG, JPEG, WEBP, GIF, SVG, etc.) for the Explorer image preview."""
    session = get_session(request)
    try:
        full_path = session.git_manager._resolve_safe_path(path)
        if not os.path.isfile(full_path):
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(full_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/files/write")
async def write_workspace_file(request: Request, payload: FileSavePayload) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.write_file(payload.path, payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/git/status")
async def get_git_status(request: Request) -> Dict[str, Any]:
    session = get_session(request)
    return session.git_manager.get_git_status()


class GitFileActionPayload(BaseModel):
    path: str


@app.post("/api/git/stage")
async def stage_all_files(request: Request) -> Dict[str, Any]:
    session = get_session(request)
    return session.git_manager.git_stage_all()


@app.post("/api/git/stage-file")
async def stage_single_file(request: Request, payload: GitFileActionPayload) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.git_stage_file(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/git/unstage-file")
async def unstage_single_file(request: Request, payload: GitFileActionPayload) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.git_unstage_file(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/git/discard-file")
async def discard_single_file(request: Request, payload: GitFileActionPayload) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.git_discard_file(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/git/file-diff")
async def get_single_file_diff(request: Request, path: str) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return {"path": path, "diff": session.git_manager.get_file_diff(path)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/git/commit")
async def commit_changes(request: Request, payload: GitCommitPayload) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.git_commit(payload.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/git/checkout")
async def checkout_branch(request: Request, payload: GitBranchPayload) -> Dict[str, Any]:
    session = get_session(request)
    try:
        return session.git_manager.git_checkout(payload.branch, payload.create)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/git/clone")
async def clone_remote_repo(request: Request, payload: GitClonePayload) -> Dict[str, Any]:
    """Clones a remote Git repository into this visitor's isolated session directory and switches into it."""
    session = get_session(request)
    gh_token = (request.headers.get("X-GitHub-Token") or payload.token or "").strip() or None
    try:
        cloned_dir = session.git_manager.git_clone_repo(
            payload.repo_url,
            payload.folder_name,
            token=gh_token,
            parent_dir=session.session_root,
        )
        session.orchestrator.workspace_dir = cloned_dir
        session.git_manager.workspace_dir = cloned_dir
        return {
            "cloned": True,
            "workspace_dir": cloned_dir,
            "workspace_name": os.path.basename(cloned_dir),
            "git_status": session.git_manager.get_git_status(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.websocket("/ws/chat")
async def websocket_chat_endpoint(websocket: WebSocket) -> None:
    active_pin = os.environ.get("AGY_ACCESS_PIN", "").strip()
    if PIN_LOCK_ENABLED and active_pin:
        ws_pin = (websocket.query_params.get("pin") or "").strip()
        if ws_pin != active_pin:
            await websocket.close(code=1008, reason="Invalid AGY_ACCESS_PIN")
            return
    session = get_session_by_id(websocket.query_params.get("session_id"))
    orchestrator = session.orchestrator
    await websocket.accept()
    active_tasks: set[asyncio.Task] = set()

    async def emit(event: Dict[str, Any]) -> None:
        try:
            await websocket.send_text(json.dumps(event))
        except Exception:
            pass

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "chat")

            if msg_type == "approval_decision":
                approval_id = data.get("approval_id", "")
                approved = bool(data.get("approved", False))
                orchestrator.resolve_approval(approval_id, approved)

            elif msg_type == "chat":
                agent_id = data.get("agent_id", "ollama-coder")
                prompt = data.get("prompt", "").strip()
                if prompt:
                    # Run chat in background task so WebSocket loop remains free to receive approval_decision events!
                    task = asyncio.create_task(
                        orchestrator.stream_chat(agent_id, prompt, emit)
                    )
                    active_tasks.add(task)
                    task.add_done_callback(active_tasks.discard)

    except WebSocketDisconnect:
        for t in active_tasks:
            t.cancel()


# Mount static frontend files
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/manifest.json")
async def serve_manifest() -> FileResponse:
    return FileResponse(os.path.join(FRONTEND_DIR, "manifest.json"))


@app.get("/")
async def serve_index() -> FileResponse:
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
