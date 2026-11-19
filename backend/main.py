"""
FastAPI Backend for Antigravity Mobile Companion.

Exposes:
- `/ws/chat` WebSocket for real-time agent streaming (thoughts, tools, tokens, and mobile approval gates)
- `/api/agents` CRUD for Multi-Agent profiles (Ollama, Gemini + Subagents, LiteRT)
- `/api/ollama/status` Live probe for local/remote Ollama models
- `/api/approvals/{approval_id}` REST endpoint for resolving mobile tool approvals
- `/api/files` File tree explorer, code reader, file writer, and diff inspection
- `/api/git/*` Git status, unified diff, branch checkout/creation, staging, and commit
- Static PWA frontend hosting at `/`
"""

from __future__ import annotations

import asyncio
import json
import os
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
WORKSPACE_DIR = os.environ.get("AGY_WORKSPACE_DIR", PROJECT_ROOT)
# Runtime toggle for PIN Lock (Can be toggled ON/OFF live from Agents & Config!)
PIN_LOCK_ENABLED = bool(os.environ.get("AGY_ACCESS_PIN", "").strip())

app = FastAPI(
    title="OwnStack IDE API",
    description="OwnStack Multi-Agent Mobile & Desktop IDE",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
async def list_github_repos(username: str = "RealRiga", token: Optional[str] = None) -> Dict[str, Any]:
    """Fetches ALL GitHub repositories (with automatic multi-page pagination) for 1-click workspace switching."""
    clean_user = username.strip() or "RealRiga"
    gh_token = (token or os.environ.get("GITHUB_TOKEN", "")).strip()
    if not gh_token:
        try:
            import subprocess
            gh_res = subprocess.run(
                ["gh", "auth", "token"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            if gh_res.returncode == 0 and gh_res.stdout.strip():
                gh_token = gh_res.stdout.strip()
        except Exception:
            pass

    headers = {"Accept": "application/vnd.github+json", "User-Agent": "OwnStack-IDE"}
    if gh_token:
        headers["Authorization"] = f"Bearer {gh_token}"
        base_url = "https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member"
    else:
        base_url = f"https://api.github.com/users/{clean_user}/repos?sort=updated&per_page=100"

    repos: List[Dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Paginate up to 5 pages (up to 500 repositories!)
            for page in range(1, 6):
                resp = await client.get(f"{base_url}&page={page}", headers=headers)
                if resp.status_code != 200:
                    if page == 1:
                        return {"repos": [], "authenticated": bool(gh_token), "error": f"GitHub API returned {resp.status_code}"}
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
            "active_workspace": os.path.basename(git_manager.workspace_dir),
            "repos": repos,
        }
    except Exception as exc:
        return {"repos": [], "authenticated": bool(gh_token), "error": str(exc)}


@app.get("/api/workspaces")
async def list_local_workspaces() -> Dict[str, Any]:
    """Lists already cloned or local project folders in the parent directory for instant switching."""
    parent_dir = os.path.dirname(git_manager.workspace_dir)
    workspaces: List[Dict[str, Any]] = []
    if os.path.isdir(parent_dir):
        for entry in sorted(os.listdir(parent_dir)):
            full = os.path.join(parent_dir, entry)
            if os.path.isdir(full) and not entry.startswith("."):
                workspaces.append(
                    {
                        "name": entry,
                        "path": full,
                        "active": os.path.abspath(full) == os.path.abspath(git_manager.workspace_dir),
                        "is_git": os.path.isdir(os.path.join(full, ".git")),
                    }
                )
    return {
        "active_workspace": git_manager.workspace_dir,
        "workspaces": workspaces,
    }

orchestrator = MultiAgentOrchestrator(workspace_dir=WORKSPACE_DIR)
git_manager = WorkspaceGitManager(workspace_dir=WORKSPACE_DIR)


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
    workspace_dir: Optional[str] = None
    pin_lock_enabled: Optional[bool] = None


@app.get("/api/health")
async def get_health() -> Dict[str, Any]:
    ollama_info = await orchestrator.check_ollama_status()
    active_pin = os.environ.get("AGY_ACCESS_PIN", "").strip()
    return {
        "status": "ok",
        "has_agy_sdk": HAS_AGY_SDK,
        "workspace_dir": orchestrator.workspace_dir,
        "ollama": ollama_info,
        "has_gemini_key": bool(orchestrator.gemini_api_key or os.environ.get("GEMINI_API_KEY")),
        "pin_lock_enabled": bool(PIN_LOCK_ENABLED and active_pin),
        "has_pin_configured": bool(active_pin),
    }


@app.post("/api/settings")
async def update_settings(payload: RuntimeSettingsPayload) -> Dict[str, Any]:
    global PIN_LOCK_ENABLED
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
    if payload.workspace_dir and os.path.isdir(payload.workspace_dir):
        abs_ws = os.path.abspath(payload.workspace_dir)
        orchestrator.workspace_dir = abs_ws
        git_manager.workspace_dir = abs_ws

    return await get_health()


@app.get("/api/ollama/status")
async def get_ollama_status(base_url: Optional[str] = None) -> Dict[str, Any]:
    return await orchestrator.check_ollama_status(base_url)


@app.get("/api/agents")
async def list_agents() -> Dict[str, Any]:
    return {"agents": orchestrator.list_profiles()}


@app.post("/api/agents")
async def create_or_update_agent(payload: AgentProfilePayload) -> Dict[str, Any]:
    profile = orchestrator.add_or_update_profile(payload.model_dump())
    return {"agent": profile, "agents": orchestrator.list_profiles()}


@app.delete("/api/agents/{agent_id}")
async def delete_agent(agent_id: str) -> Dict[str, Any]:
    deleted = orchestrator.delete_profile(agent_id)
    if not deleted:
        raise HTTPException(status_code=400, detail="Could not delete agent profile.")
    return {"deleted": True, "agents": orchestrator.list_profiles()}


@app.get("/api/agents/{agent_id}/history")
async def get_agent_history(agent_id: str) -> Dict[str, Any]:
    return {
        "agent_id": agent_id,
        "history": orchestrator.conversation_history.get(agent_id, []),
    }


@app.post("/api/approvals/{approval_id}")
async def decide_approval(approval_id: str, payload: ApprovalDecisionPayload) -> Dict[str, Any]:
    resolved = orchestrator.resolve_approval(approval_id, payload.approved)
    return {"approval_id": approval_id, "resolved": resolved, "approved": payload.approved}


@app.get("/api/files")
async def list_files() -> Dict[str, Any]:
    return {
        "workspace_dir": git_manager.workspace_dir,
        "files": git_manager.list_file_tree(),
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
async def read_workspace_file(path: str) -> Dict[str, Any]:
    try:
        return git_manager.read_file(path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/files/raw")
async def read_raw_workspace_file(path: str) -> FileResponse:
    """Serves raw binary/image files (PNG, JPEG, WEBP, GIF, SVG, etc.) for the Explorer image preview."""
    try:
        full_path = git_manager._resolve_safe_path(path)
        if not os.path.isfile(full_path):
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(full_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/files/write")
async def write_workspace_file(payload: FileSavePayload) -> Dict[str, Any]:
    try:
        return git_manager.write_file(payload.path, payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/git/status")
async def get_git_status() -> Dict[str, Any]:
    return git_manager.get_git_status()


@app.post("/api/git/stage")
async def stage_all_files() -> Dict[str, Any]:
    return git_manager.git_stage_all()


@app.post("/api/git/commit")
async def commit_changes(payload: GitCommitPayload) -> Dict[str, Any]:
    try:
        return git_manager.git_commit(payload.message)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/git/checkout")
async def checkout_branch(payload: GitBranchPayload) -> Dict[str, Any]:
    try:
        return git_manager.git_checkout(payload.branch, payload.create)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/git/clone")
async def clone_remote_repo(payload: GitClonePayload) -> Dict[str, Any]:
    """Clones a remote Git repository into the cloud/local workspace and switches into it."""
    try:
        cloned_dir = git_manager.git_clone_repo(
            payload.repo_url,
            payload.folder_name,
            token=payload.token,
        )
        orchestrator.workspace_dir = cloned_dir
        git_manager.workspace_dir = cloned_dir
        return {
            "cloned": True,
            "workspace_dir": cloned_dir,
            "git_status": git_manager.get_git_status(),
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

