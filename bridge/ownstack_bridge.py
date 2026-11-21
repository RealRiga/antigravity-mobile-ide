#!/usr/bin/env python3
"""
OwnStack Local IDE Chat Bridge (Zero external dependencies — Python 3.9+ stdlib only).

Runs privately on YOUR computer so YOUR browser in OwnStack IDE can sync chats from:
  - Antigravity IDE (~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl)
  - Claude Code     (~/.claude/projects/*/*.jsonl)
  - Cursor          (User/workspaceStorage/*/state.vscdb)
  - VS Code Cline   (User/globalStorage/saoudrizwan.claude-dev/tasks/*)

PRIVACY GUARANTEE:
  - Binds locally on 127.0.0.1:8787 by default (expose only to yourself via Tailscale or Cloudflare Tunnel).
  - Protected by a personal Bearer Token stored in ~/.ownstack_bridge_token (chmod 600).
  - OwnStack's frontend connects DIRECTLY from your browser to your bridge — your cloud host (Render/Railway)
    NEVER receives, proxies, or stores your IDE chats or bridge token.

Usage:
  python3 bridge/ownstack_bridge.py
  python3 bridge/ownstack_bridge.py --host 0.0.0.0 --port 8787
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import secrets
import socket
import sqlite3
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

HOME = Path.home()
TOKEN_FILE = HOME / ".ownstack_bridge_token"


def get_or_create_bridge_token() -> str:
    env_token = os.environ.get("OWNSTACK_BRIDGE_TOKEN", "").strip()
    if env_token:
        return env_token
    if TOKEN_FILE.is_file():
        existing = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if existing:
            return existing
    token = f"osb_{secrets.token_urlsafe(24)}"
    TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except OSError:
        pass
    return token


def _iso_to_ms(ts: Any) -> int:
    if isinstance(ts, (int, float)):
        return int(ts * 1000) if ts < 1e12 else int(ts)
    if isinstance(ts, str) and ts.strip():
        try:
            dt = datetime.fromisoformat(ts.strip().replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except ValueError:
            pass
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _strip_user_request_tags(text: str) -> str:
    if not text:
        return ""
    m = re.search(r"<USER_REQUEST>\s*([\s\S]*?)\s*</USER_REQUEST>", text)
    if m:
        return m.group(1).strip()
    return text.strip()


def _infer_project_from_text(text: str) -> str:
    """Infers a likely repository/project folder name from file paths referenced in a transcript."""
    if not text:
        return ""
    # Look for common workspace path patterns: /development/.../<repo>/, /projects/<repo>/, /repos/<repo>/, file:///.../<repo>/
    patterns = [
        r"(?:file://)?/(?:home|Users)/[^/\s\"']+/[^/\s\"']+(?:/[^/\s\"']+)?/([a-zA-Z0-9._-]+)/(?:backend|frontend|src|app|lib|packages|README\.md|package\.json|requirements\.txt|Dockerfile|pyproject\.toml)",
        r"Active Workspaces:\s*-\s*[^\n]*/([a-zA-Z0-9._-]+)",
        r"Command Working Directory:\s*[^\n]*/([a-zA-Z0-9._-]+)",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            candidate = m.group(1).strip()
            if candidate and candidate not in (".gemini", "brain", "antigravity", "tmp"):
                return candidate
    return ""


# =============================================================================
# 1. ANTIGRAVITY IDE SCANNER
# =============================================================================
def _antigravity_brain_dir() -> Path:
    custom = os.environ.get("ANTIGRAVITY_BRAIN_DIR", "").strip()
    if custom:
        return Path(custom).expanduser()
    return HOME / ".gemini" / "antigravity" / "brain"


def parse_antigravity_transcript(conv_dir: Path, include_messages: bool = False) -> Optional[Dict[str, Any]]:
    log_path = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
    if not log_path.is_file():
        return None

    messages: List[Dict[str, Any]] = []
    project_name = ""
    created_ms = int(log_path.stat().st_mtime * 1000)
    updated_ms = created_ms

    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as f:
            for raw_line in f:
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    step = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue

                step_type = step.get("type", "")
                content = step.get("content") or ""
                if not isinstance(content, str):
                    content = json.dumps(content)

                if not project_name:
                    inferred = _infer_project_from_text(content)
                    if not inferred and step.get("tool_calls"):
                        inferred = _infer_project_from_text(json.dumps(step.get("tool_calls")))
                    if inferred:
                        project_name = inferred

                ts_ms = _iso_to_ms(step.get("created_at"))
                if not messages and ts_ms:
                    created_ms = ts_ms
                if ts_ms:
                    updated_ms = max(updated_ms, ts_ms)

                if step_type == "USER_INPUT" and step.get("source") == "USER_EXPLICIT":
                    clean = _strip_user_request_tags(content)
                    if clean:
                        messages.append({"role": "user", "content": clean, "timestamp": ts_ms})
                elif step_type == "PLANNER_RESPONSE" and content.strip():
                    messages.append({"role": "assistant", "content": content.strip(), "timestamp": ts_ms})
    except OSError:
        return None

    if not messages:
        return None

    first_user = next((m["content"] for m in messages if m["role"] == "user"), "Antigravity Chat")
    title = first_user.splitlines()[0][:60]
    if len(first_user.splitlines()[0]) > 60:
        title += "..."

    result: Dict[str, Any] = {
        "id": f"antigravity:{conv_dir.name}",
        "raw_id": conv_dir.name,
        "ide": "antigravity",
        "ide_label": "Antigravity IDE",
        "project": project_name or "unassigned",
        "title": title,
        "message_count": len(messages),
        "createdAt": created_ms,
        "updatedAt": updated_ms,
    }
    if include_messages:
        result["messages"] = messages
    return result


def scan_antigravity_chats(project_filter: str = "", include_messages: bool = False, limit: int = 50) -> List[Dict[str, Any]]:
    brain = _antigravity_brain_dir()
    if not brain.is_dir():
        return []
    entries: List[Tuple[float, Path]] = []
    for child in brain.iterdir():
        if not child.is_dir():
            continue
        log_path = child / ".system_generated" / "logs" / "transcript.jsonl"
        if log_path.is_file():
            try:
                entries.append((log_path.stat().st_mtime, child))
            except OSError:
                pass
    entries.sort(key=lambda x: x[0], reverse=True)

    chats: List[Dict[str, Any]] = []
    pf = project_filter.strip().lower()
    for _, conv_dir in entries:
        if len(chats) >= limit:
            break
        parsed = parse_antigravity_transcript(conv_dir, include_messages=include_messages)
        if not parsed:
            continue
        if pf and pf != "all" and pf not in parsed["project"].lower():
            continue
        chats.append(parsed)
    return chats


# =============================================================================
# 2. CLAUDE CODE SCANNER
# =============================================================================
def _claude_projects_dir() -> Path:
    return HOME / ".claude" / "projects"


def parse_claude_code_file(jsonl_path: Path, include_messages: bool = False) -> Optional[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = []
    project_name = jsonl_path.parent.name.split("-")[-1] if jsonl_path.parent.name else "unassigned"
    created_ms = int(jsonl_path.stat().st_mtime * 1000)
    updated_ms = created_ms

    try:
        with jsonl_path.open("r", encoding="utf-8", errors="replace") as f:
            for raw_line in f:
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    rec = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue
                if rec.get("cwd"):
                    project_name = os.path.basename(str(rec["cwd"]).rstrip("/\\")) or project_name
                rec_type = rec.get("type")
                msg_obj = rec.get("message") if isinstance(rec.get("message"), dict) else {}
                role = msg_obj.get("role") or rec_type
                if role not in ("user", "assistant"):
                    continue
                raw_content = msg_obj.get("content", rec.get("content", ""))
                if isinstance(raw_content, list):
                    parts = [
                        p.get("text", "")
                        for p in raw_content
                        if isinstance(p, dict) and p.get("type") == "text"
                    ]
                    text = "\n".join(p for p in parts if p).strip()
                else:
                    text = str(raw_content or "").strip()
                if not text:
                    continue
                ts_ms = _iso_to_ms(rec.get("timestamp"))
                if not messages and ts_ms:
                    created_ms = ts_ms
                updated_ms = max(updated_ms, ts_ms)
                messages.append({"role": role, "content": text, "timestamp": ts_ms})
    except OSError:
        return None

    if not messages:
        return None

    first_user = next((m["content"] for m in messages if m["role"] == "user"), "Claude Code Chat")
    title = first_user.splitlines()[0][:60]
    result: Dict[str, Any] = {
        "id": f"claude-code:{jsonl_path.parent.name}/{jsonl_path.stem}",
        "raw_id": f"{jsonl_path.parent.name}/{jsonl_path.stem}",
        "ide": "claude-code",
        "ide_label": "Claude Code",
        "project": project_name,
        "title": title,
        "message_count": len(messages),
        "createdAt": created_ms,
        "updatedAt": updated_ms,
    }
    if include_messages:
        result["messages"] = messages
    return result


def scan_claude_code_chats(project_filter: str = "", include_messages: bool = False, limit: int = 50) -> List[Dict[str, Any]]:
    root = _claude_projects_dir()
    if not root.is_dir():
        return []
    files = sorted(root.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    chats: List[Dict[str, Any]] = []
    pf = project_filter.strip().lower()
    for fp in files:
        if len(chats) >= limit:
            break
        parsed = parse_claude_code_file(fp, include_messages=include_messages)
        if not parsed:
            continue
        if pf and pf != "all" and pf not in parsed["project"].lower():
            continue
        chats.append(parsed)
    return chats


# =============================================================================
# 3. CURSOR IDE SCANNER
# =============================================================================
def _cursor_workspace_storage_dirs() -> List[Path]:
    sys_name = platform.system()
    candidates = []
    if sys_name == "Darwin":
        candidates.append(HOME / "Library" / "Application Support" / "Cursor" / "User" / "workspaceStorage")
    elif sys_name == "Windows":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            candidates.append(Path(appdata) / "Cursor" / "User" / "workspaceStorage")
    else:
        candidates.append(HOME / ".config" / "Cursor" / "User" / "workspaceStorage")
    return [c for c in candidates if c.is_dir()]


def scan_cursor_chats(project_filter: str = "", include_messages: bool = False, limit: int = 50) -> List[Dict[str, Any]]:
    chats: List[Dict[str, Any]] = []
    pf = project_filter.strip().lower()
    for ws_root in _cursor_workspace_storage_dirs():
        ws_dirs = sorted(
            [d for d in ws_root.iterdir() if d.is_dir() and (d / "state.vscdb").is_file()],
            key=lambda d: (d / "state.vscdb").stat().st_mtime,
            reverse=True,
        )
        for ws_dir in ws_dirs:
            if len(chats) >= limit:
                break
            project_name = ws_dir.name
            ws_json = ws_dir / "workspace.json"
            if ws_json.is_file():
                try:
                    wdata = json.loads(ws_json.read_text(encoding="utf-8", errors="replace"))
                    folder_uri = wdata.get("folder", "")
                    if folder_uri:
                        project_name = os.path.basename(unquote(folder_uri).rstrip("/\\")) or project_name
                except Exception:
                    pass
            if pf and pf != "all" and pf not in project_name.lower():
                continue

            db_path = ws_dir / "state.vscdb"
            try:
                conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
                cur = conn.cursor()
                cur.execute(
                    "SELECT key, value FROM ItemTable WHERE key IN "
                    "('workbench.panel.aichat.view.aichat.chatdata', 'aiService.prompts')"
                )
                rows = cur.fetchall()
                conn.close()
            except Exception:
                continue

            mtime_ms = int(db_path.stat().st_mtime * 1000)
            for key, val in rows:
                try:
                    parsed_val = json.loads(val)
                except Exception:
                    continue
                if key == "workbench.panel.aichat.view.aichat.chatdata" and isinstance(parsed_val, dict):
                    for tab in parsed_val.get("tabs", []):
                        bubbles = tab.get("bubbles", [])
                        msgs = []
                        for b in bubbles:
                            txt = (b.get("text") or b.get("rawText") or "").strip()
                            if not txt:
                                continue
                            role = "user" if b.get("type") == "user" else "assistant"
                            msgs.append({"role": role, "content": txt, "timestamp": mtime_ms})
                        if not msgs:
                            continue
                        tid = tab.get("tabId") or str(len(chats))
                        title = (tab.get("chatTitle") or msgs[0]["content"].splitlines()[0])[:60]
                        entry: Dict[str, Any] = {
                            "id": f"cursor:{ws_dir.name}:{tid}",
                            "raw_id": f"{ws_dir.name}:{tid}",
                            "ide": "cursor",
                            "ide_label": "Cursor",
                            "project": project_name,
                            "title": title,
                            "message_count": len(msgs),
                            "createdAt": mtime_ms,
                            "updatedAt": mtime_ms,
                        }
                        if include_messages:
                            entry["messages"] = msgs
                        chats.append(entry)
    return chats[:limit]


# =============================================================================
# 4. VS CODE (CLINE / ROO CODE) SCANNER
# =============================================================================
def _vscode_cline_tasks_dirs() -> List[Path]:
    sys_name = platform.system()
    roots = []
    if sys_name == "Darwin":
        base = HOME / "Library" / "Application Support" / "Code" / "User" / "globalStorage"
    elif sys_name == "Windows":
        base = Path(os.environ.get("APPDATA", "")) / "Code" / "User" / "globalStorage"
    else:
        base = HOME / ".config" / "Code" / "User" / "globalStorage"
    for ext_id in ("saoudrizwan.claude-dev", "rooveterinaryinc.roo-cline"):
        tdir = base / ext_id / "tasks"
        if tdir.is_dir():
            roots.append(tdir)
    return roots


def scan_vscode_cline_chats(project_filter: str = "", include_messages: bool = False, limit: int = 50) -> List[Dict[str, Any]]:
    chats: List[Dict[str, Any]] = []
    pf = project_filter.strip().lower()
    for tdir in _vscode_cline_tasks_dirs():
        task_dirs = sorted(
            [d for d in tdir.iterdir() if d.is_dir() and (d / "api_conversation_history.json").is_file()],
            key=lambda d: (d / "api_conversation_history.json").stat().st_mtime,
            reverse=True,
        )
        for td in task_dirs:
            if len(chats) >= limit:
                break
            hist_file = td / "api_conversation_history.json"
            try:
                raw = json.loads(hist_file.read_text(encoding="utf-8", errors="replace"))
            except Exception:
                continue
            if not isinstance(raw, list):
                continue
            msgs = []
            project_name = ""
            mtime_ms = int(hist_file.stat().st_mtime * 1000)
            for item in raw:
                role = item.get("role")
                if role not in ("user", "assistant"):
                    continue
                content = item.get("content", "")
                if isinstance(content, list):
                    text = "\n".join(
                        p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"
                    ).strip()
                else:
                    text = str(content or "").strip()
                if not text:
                    continue
                if not project_name:
                    project_name = _infer_project_from_text(text)
                msgs.append({"role": role, "content": text, "timestamp": mtime_ms})
            if not msgs:
                continue
            project_name = project_name or "unassigned"
            if pf and pf != "all" and pf not in project_name.lower():
                continue
            title = msgs[0]["content"].splitlines()[0][:60]
            entry: Dict[str, Any] = {
                "id": f"vscode-cline:{td.name}",
                "raw_id": td.name,
                "ide": "vscode-cline",
                "ide_label": "VS Code (Cline/Roo)",
                "project": project_name,
                "title": title,
                "message_count": len(msgs),
                "createdAt": mtime_ms,
                "updatedAt": mtime_ms,
            }
            if include_messages:
                entry["messages"] = msgs
            chats.append(entry)
    return chats[:limit]


def detect_available_ides() -> List[Dict[str, Any]]:
    return [
        {"id": "antigravity", "label": "Antigravity IDE", "detected": _antigravity_brain_dir().is_dir()},
        {"id": "claude-code", "label": "Claude Code", "detected": _claude_projects_dir().is_dir()},
        {"id": "cursor", "label": "Cursor", "detected": len(_cursor_workspace_storage_dirs()) > 0},
        {"id": "vscode-cline", "label": "VS Code (Cline/Roo)", "detected": len(_vscode_cline_tasks_dirs()) > 0},
    ]


def collect_chats(ide: str = "all", project: str = "", include_messages: bool = False, limit: int = 50) -> List[Dict[str, Any]]:
    all_chats: List[Dict[str, Any]] = []
    if ide in ("all", "antigravity"):
        all_chats.extend(scan_antigravity_chats(project, include_messages=include_messages, limit=limit))
    if ide in ("all", "claude-code"):
        all_chats.extend(scan_claude_code_chats(project, include_messages=include_messages, limit=limit))
    if ide in ("all", "cursor"):
        all_chats.extend(scan_cursor_chats(project, include_messages=include_messages, limit=limit))
    if ide in ("all", "vscode-cline"):
        all_chats.extend(scan_vscode_cline_chats(project, include_messages=include_messages, limit=limit))
    all_chats.sort(key=lambda c: c.get("updatedAt", 0), reverse=True)
    return all_chats[:limit]


# =============================================================================
# HTTP SERVER WITH TOKEN AUTH & CORS
# =============================================================================
def make_handler(bridge_token: str):
    class BridgeHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            # Keep terminal clean and never log tokens
            sys.stderr.write(f"[ownstack-bridge] {self.address_string()} {args[0]}\n")

        def _send_cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, X-Bridge-Token, Content-Type")

        def _send_json(self, code: int, payload: Dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self._send_cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _check_auth(self) -> bool:
            auth = (self.headers.get("Authorization") or "").strip()
            header_tok = (self.headers.get("X-Bridge-Token") or "").strip()
            supplied = ""
            if auth.lower().startswith("bearer "):
                supplied = auth[7:].strip()
            elif header_tok:
                supplied = header_tok
            if not secrets.compare_digest(supplied, bridge_token):
                self._send_json(401, {"error": "Unauthorized: invalid or missing bridge token"})
                return False
            return True

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._send_cors()
            self.end_headers()

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            qs = parse_qs(parsed.query)

            if path == "/health":
                self._send_json(200, {"status": "ok", "service": "ownstack-ide-bridge"})
                return

            if not self._check_auth():
                return

            if path == "/bridge/health":
                self._send_json(
                    200,
                    {
                        "status": "ok",
                        "hostname": socket.gethostname(),
                        "ides": detect_available_ides(),
                    },
                )
                return

            if path == "/bridge/chats":
                ide = (qs.get("ide", ["all"])[0] or "all").strip().lower()
                project = (qs.get("project", [""])[0] or "").strip()
                include_msgs = (qs.get("include_messages", ["false"])[0] or "false").lower() == "true"
                try:
                    limit = min(max(int(qs.get("limit", ["50"])[0]), 1), 200)
                except ValueError:
                    limit = 50
                chats = collect_chats(ide=ide, project=project, include_messages=include_msgs, limit=limit)
                self._send_json(200, {"chats": chats, "total": len(chats), "ides": detect_available_ides()})
                return

            if path.startswith("/bridge/chat/"):
                chat_id = unquote(path[len("/bridge/chat/"):])
                if ":" not in chat_id:
                    self._send_json(400, {"error": "Invalid chat_id format"})
                    return
                ide_name, raw_id = chat_id.split(":", 1)
                if ide_name == "antigravity":
                    conv_dir = _antigravity_brain_dir() / raw_id
                    chat = parse_antigravity_transcript(conv_dir, include_messages=True)
                elif ide_name == "claude-code":
                    parts = raw_id.split("/", 1)
                    if len(parts) != 2:
                        self._send_json(400, {"error": "Invalid claude-code chat_id"})
                        return
                    fp = _claude_projects_dir() / parts[0] / f"{parts[1]}.jsonl"
                    chat = parse_claude_code_file(fp, include_messages=True)
                else:
                    # Fallback scan for cursor / vscode-cline
                    found = [
                        c for c in collect_chats(ide=ide_name, include_messages=True, limit=200)
                        if c["id"] == chat_id
                    ]
                    chat = found[0] if found else None

                if not chat:
                    self._send_json(404, {"error": "Chat not found"})
                    return
                self._send_json(200, {"chat": chat})
                return

            self._send_json(404, {"error": "Not found"})

    return BridgeHandler


def main() -> None:
    parser = argparse.ArgumentParser(description="OwnStack Private Local IDE Chat Bridge")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1; use 0.0.0.0 for Tailscale)")
    parser.add_argument("--port", type=int, default=8787, help="Bind port (default: 8787)")
    args = parser.parse_args()

    token = get_or_create_bridge_token()
    ides = detect_available_ides()
    detected_names = [i["label"] for i in ides if i["detected"]] or ["None detected yet"]

    print("=" * 64)
    print("  OwnStack Private Local IDE Chat Bridge")
    print("=" * 64)
    print(f"  Listening on : http://{args.host}:{args.port}")
    print(f"  Bridge Token : {token}")
    print(f"  Detected IDEs: {', '.join(detected_names)}")
    print("-" * 64)
    print("  Paste the URL and Bridge Token into OwnStack IDE -> Agents & Config")
    print("  -> 'IDE Chat Bridge (Private)'. Your token stays ONLY in your browser.")
    print("  To access from your phone over HTTPS, run in another terminal:")
    print(f"    cloudflared tunnel --url http://127.0.0.1:{args.port}")
    print("=" * 64)

    server = ThreadingHTTPServer((args.host, args.port), make_handler(token))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBridge stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
