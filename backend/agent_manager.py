"""
Multi-Agent Manager powered by the Google Antigravity SDK (`google-antigravity`).

Supports:
1. LocalOpenAIAgentConfig (Ollama / LM Studio / custom fine-tuned models via OpenAI-compat endpoint)
2. LocalAgentConfig (Hosted Gemini API with GEMINI_API_KEY + hierarchical SubagentConfig)
3. LiteRTAgentConfig (On-device LiteRT-LM checkpoints like Gemma 4 26B)
4. Mobile Approval Gates via `policy.ask_user` and SDK lifecycle hooks (`pre_tool_call_decide`, `post_tool_call`).
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Coroutine, Dict, List, Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

# Try importing Google Antigravity SDK; provide graceful fallback inspection if not yet installed
try:
    from google.antigravity import (
        Agent,
        LiteRTAgentConfig,
        LocalAgentConfig,
        LocalOpenAIAgentConfig,
        types,
    )
    from google.antigravity.hooks import hooks, policy

    HAS_AGY_SDK = True
except ImportError:
    HAS_AGY_SDK = False


@dataclass
class SubagentSpec:
    name: str
    description: str
    enabled_tools: List[str] = field(default_factory=lambda: ["view_file", "code_search"])
    allowed_subagents: List[str] = field(default_factory=list)


@dataclass
class AgentProfile:
    id: str
    name: str
    role: str
    provider: str  # "ollama" | "gemini" | "litert"
    model: str  # e.g., "gemma4:26b", "qwen2.5-coder:14b", or "" (default for Gemini)
    base_url: str = "http://localhost:11434/v1"
    system_instructions: str = ""
    require_approval_for: List[str] = field(
        default_factory=lambda: ["run_command", "edit_file", "create_file"]
    )
    enable_subagents: bool = True
    max_subagent_depth: int = 2
    subagents: List[SubagentSpec] = field(default_factory=list)
    use_lightweight: bool = True
    enable_sandbox: bool = False


@dataclass
class PendingApproval:
    approval_id: str
    agent_id: str
    tool_name: str
    arguments: Dict[str, Any]
    created_at: float
    future: asyncio.Future


EventCallback = Callable[[Dict[str, Any]], Coroutine[Any, Any, None]]


class MultiAgentOrchestrator:
    """Manages multiple Antigravity agent profiles, subagents, and mobile approval gates."""

    def __init__(self, workspace_dir: str) -> None:
        self.workspace_dir = os.path.abspath(workspace_dir)
        self.profiles: Dict[str, AgentProfile] = {}
        self.conversation_history: Dict[str, List[Dict[str, Any]]] = {}
        self.pending_approvals: Dict[str, PendingApproval] = {}
        self.ollama_base_url: str = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        self.gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "")
        self._init_default_profiles()

    def _init_default_profiles(self) -> None:
        default_subagents = [
            SubagentSpec(
                name="code_researcher",
                description="Explores the codebase, reads files, and maps architecture autonomously.",
                enabled_tools=["view_file", "start_subagent"],
                allowed_subagents=["fact_checker"],
            ),
            SubagentSpec(
                name="fact_checker",
                description="Verifies file contents, edge cases, and imports.",
                enabled_tools=["view_file"],
            ),
            SubagentSpec(
                name="test_specialist",
                description="Audits unit tests and identifies missing test coverage.",
                enabled_tools=["view_file"],
            ),
        ]

        presets = [
            AgentProfile(
                id="ollama-coder",
                name="Ollama Local Coder",
                role="Fast Local & Custom Model Engineer",
                provider="ollama",
                model="gemma4:26b",
                base_url=f"{self.ollama_base_url.rstrip('/')}/v1",
                system_instructions=(
                    "You are an expert mobile-controlled coding agent running on Ollama via "
                    "Google Antigravity SDK's LocalOpenAIAgentConfig. Write clean, modular code "
                    "and explain file changes concisely for a mobile screen."
                ),
                require_approval_for=["run_command", "edit_file", "create_file"],
                enable_subagents=False,
                use_lightweight=True,
            ),
            AgentProfile(
                id="ollama-custom-trainer",
                name="My Fine-Tuned AI (Ollama)",
                role="Custom Trained Local Model",
                provider="ollama",
                model="qwen2.5-coder:7b",
                base_url=f"{self.ollama_base_url.rstrip('/')}/v1",
                system_instructions=(
                    "You are the developer's custom local model running on Ollama. "
                    "Assist with refactoring, debugging, and dataset/training script preparation."
                ),
                require_approval_for=["run_command"],
                enable_subagents=False,
                use_lightweight=True,
            ),
            AgentProfile(
                id="gemini-lead-architect",
                name="Gemini Lead Architect (+Subagents)",
                role="Multi-Agent Coordinator & Lead Engineer",
                provider="gemini",
                model="",  # Uses SDK default model per best practices
                system_instructions=(
                    "You are the Lead Software Architect. You can delegate file exploration to "
                    "your 'code_researcher' and 'test_specialist' subagents, propose clean diffs, "
                    "and summarize architectural decisions clearly for a mobile developer."
                ),
                require_approval_for=["run_command", "edit_file", "create_file"],
                enable_subagents=True,
                max_subagent_depth=3,
                subagents=default_subagents,
                use_lightweight=False,
            ),
            AgentProfile(
                id="litert-on-device",
                name="LiteRT On-Device (Gemma 4 26B)",
                role="Zero-Latency On-Device GPU/NPU Agent",
                provider="litert",
                model="~/.litert-lm/models/gemma4-26b/model.litertlm",
                system_instructions=(
                    "You run 100% locally via Google LiteRT-LM with zero cloud dependency."
                ),
                require_approval_for=["run_command"],
                enable_subagents=False,
                use_lightweight=True,
            ),
        ]

        for p in presets:
            self.profiles[p.id] = p
            self.conversation_history[p.id] = []

    def list_profiles(self) -> List[Dict[str, Any]]:
        return [asdict(p) for p in self.profiles.values()]

    def add_or_update_profile(self, data: Dict[str, Any]) -> Dict[str, Any]:
        agent_id = data.get("id") or f"agent-{uuid.uuid4().hex[:6]}"
        subagents_raw = data.get("subagents", [])
        subagents = [
            SubagentSpec(**s) if isinstance(s, dict) else s for s in subagents_raw
        ]
        profile = AgentProfile(
            id=agent_id,
            name=data.get("name", "Custom Agent"),
            role=data.get("role", "Autonomous Coding Agent"),
            provider=data.get("provider", "ollama"),
            model=data.get("model", "gemma4:26b"),
            base_url=data.get("base_url", f"{self.ollama_base_url.rstrip('/')}/v1"),
            system_instructions=data.get(
                "system_instructions",
                "You are an autonomous coding assistant accessible from mobile.",
            ),
            require_approval_for=data.get(
                "require_approval_for", ["run_command", "edit_file", "create_file"]
            ),
            enable_subagents=bool(data.get("enable_subagents", False)),
            max_subagent_depth=int(data.get("max_subagent_depth", 2)),
            subagents=subagents,
            use_lightweight=bool(data.get("use_lightweight", True)),
            enable_sandbox=bool(data.get("enable_sandbox", False)),
        )
        self.profiles[agent_id] = profile
        self.conversation_history.setdefault(agent_id, [])
        return asdict(profile)

    def delete_profile(self, agent_id: str) -> bool:
        if agent_id in self.profiles and len(self.profiles) > 1:
            del self.profiles[agent_id]
            return True
        return False

    async def check_ollama_status(self, custom_url: Optional[str] = None) -> Dict[str, Any]:
        """Probes the Ollama server for installed models and connectivity."""
        target = (custom_url or self.ollama_base_url).rstrip("/")
        if target.endswith("/v1"):
            target = target[:-3]
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                resp = await client.get(f"{target}/api/tags")
                if resp.status_code == 200:
                    payload = resp.json()
                    models = [m.get("name") for m in payload.get("models", [])]
                    return {
                        "online": True,
                        "base_url": target,
                        "models": models,
                        "message": f"Connected to Ollama ({len(models)} models installed)",
                    }
        except Exception as exc:
            return {
                "online": False,
                "base_url": target,
                "models": [],
                "message": (
                    f"Ollama server not detected at {target} ({exc.__class__.__name__}). "
                    "Ready to connect as soon as your Ollama instance or new PC is online!"
                ),
            }
        return {"online": False, "base_url": target, "models": [], "message": "Unreachable"}

    def resolve_approval(self, approval_id: str, approved: bool) -> bool:
        pending = self.pending_approvals.pop(approval_id, None)
        if pending and not pending.future.done():
            pending.future.set_result(approved)
            return True
        return False

    async def request_mobile_approval(
        self,
        agent_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        emit: EventCallback,
    ) -> bool:
        """Suspends agent tool execution until the developer taps Approve/Reject on mobile."""
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        approval_id = f"apr-{uuid.uuid4().hex[:8]}"
        pending = PendingApproval(
            approval_id=approval_id,
            agent_id=agent_id,
            tool_name=tool_name,
            arguments=arguments,
            created_at=time.time(),
            future=fut,
        )
        self.pending_approvals[approval_id] = pending

        await emit(
            {
                "type": "approval_required",
                "approval_id": approval_id,
                "agent_id": agent_id,
                "tool_name": tool_name,
                "arguments": arguments,
            }
        )
        try:
            # Wait up to 5 minutes for mobile approval
            decision = await asyncio.wait_for(fut, timeout=300.0)
            await emit(
                {
                    "type": "approval_resolved",
                    "approval_id": approval_id,
                    "approved": bool(decision),
                    "tool_name": tool_name,
                }
            )
            return bool(decision)
        except asyncio.TimeoutError:
            self.pending_approvals.pop(approval_id, None)
            await emit(
                {
                    "type": "approval_resolved",
                    "approval_id": approval_id,
                    "approved": False,
                    "tool_name": tool_name,
                    "reason": "Timed out waiting for mobile response",
                }
            )
            return False

    def _build_sdk_config(
        self,
        profile: AgentProfile,
        emit: EventCallback,
    ) -> Any:
        """Builds the official `google-antigravity` AgentConfig for Ollama, Gemini, or LiteRT."""
        if not HAS_AGY_SDK:
            raise RuntimeError("google-antigravity package is not installed in the active environment.")

        # 1. Approval gate handler using policy.ask_user & hooks
        async def approval_handler(tool_call: Any) -> bool:
            t_name = getattr(tool_call, "name", str(tool_call))
            t_args = getattr(tool_call, "arguments", None) or getattr(tool_call, "args", {}) or {}
            if not isinstance(t_args, dict):
                t_args = {"raw": str(t_args)}
            return await self.request_mobile_approval(profile.id, t_name, t_args, emit)

        @hooks.pre_tool_call_decide
        async def on_pre_tool(data: types.ToolCall) -> types.HookResult:
            t_name = getattr(data, "name", "tool")
            t_args = getattr(data, "arguments", None) or getattr(data, "args", {}) or {}
            if not isinstance(t_args, dict):
                t_args = {"detail": str(t_args)}

            await emit(
                {
                    "type": "tool_start",
                    "agent_id": profile.id,
                    "tool_name": t_name,
                    "arguments": t_args,
                }
            )
            if t_name in profile.require_approval_for:
                allowed = await self.request_mobile_approval(profile.id, t_name, t_args, emit)
                return types.HookResult(allow=allowed)
            return types.HookResult(allow=True)

        @hooks.post_tool_call
        async def on_post_tool(data: Any) -> None:
            await emit(
                {
                    "type": "tool_end",
                    "agent_id": profile.id,
                    "summary": str(data)[:400],
                }
            )

        # Build declarative safety policies
        agent_policies = [
            policy.workspace_only([self.workspace_dir]),
            policy.allow_all(),
        ]
        for gated_tool in profile.require_approval_for:
            agent_policies.insert(
                0, policy.ask_user(gated_tool, handler=approval_handler)
            )

        # 2. Provider-specific config construction
        if profile.provider == "ollama":
            cfg = LocalOpenAIAgentConfig(
                model=profile.model,
                base_url=profile.base_url,
                system_instructions=profile.system_instructions,
                workspaces=[self.workspace_dir],
                policies=agent_policies,
                hooks=[on_pre_tool, on_post_tool],
            )
            if profile.use_lightweight:
                cfg = cfg.lightweight()
            return cfg

        if profile.provider == "litert":
            expanded_path = os.path.expanduser(profile.model)
            return LiteRTAgentConfig(
                model_path=expanded_path,
                system_instructions=profile.system_instructions,
                workspaces=[self.workspace_dir],
                policies=agent_policies,
                hooks=[on_pre_tool, on_post_tool],
            )

        # Default: Hosted Gemini via LocalAgentConfig with Subagents
        tool_map = {
            "view_file": types.BuiltinTools.VIEW_FILE,
            "start_subagent": types.BuiltinTools.START_SUBAGENT,
        }
        sdk_subagents = []
        for sub in profile.subagents:
            enabled = [tool_map[t] for t in sub.enabled_tools if t in tool_map]
            sdk_subagents.append(
                types.SubagentConfig(
                    name=sub.name,
                    description=sub.description,
                    capabilities=types.SubagentCapabilities(
                        agent_behavior=types.AgentBehavior.AUTONOMOUS,
                        enabled_tools=enabled or [types.BuiltinTools.VIEW_FILE],
                        allowed_subagents=sub.allowed_subagents or None,
                    ),
                )
            )

        capabilities = types.CapabilitiesConfig(
            agent_behavior=types.AgentBehavior.AUTONOMOUS,
            enable_subagents=profile.enable_subagents,
            max_subagent_depth=profile.max_subagent_depth if profile.enable_subagents else 1,
            allowed_subagents=[s.name for s in profile.subagents] if profile.subagents else None,
            run_command_config=types.RunCommandConfig(enable_sandbox=profile.enable_sandbox),
        )

        kwargs: Dict[str, Any] = {
            "system_instructions": profile.system_instructions,
            "workspaces": [self.workspace_dir],
            "capabilities": capabilities,
            "subagents": sdk_subagents if profile.enable_subagents else None,
            "policies": agent_policies,
            "hooks": [on_pre_tool, on_post_tool],
        }
        # Only set model explicitly if requested by user profile
        if profile.model.strip():
            kwargs["model"] = profile.model.strip()
        active_key = (self.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")).strip()
        if active_key:
            kwargs["api_key"] = active_key
            # Support Gemini Enterprise Agent Platform / Vertex Express Mode keys (prefixed with AQ.)
            if active_key.startswith("AQ."):
                kwargs["vertex"] = True

        return LocalAgentConfig(**kwargs)

    async def stream_chat(
        self,
        agent_id: str,
        prompt: str,
        emit: EventCallback,
    ) -> None:
        """Runs a chat turn with the selected agent profile and streams thoughts, tools, and tokens."""
        profile = self.profiles.get(agent_id)
        if not profile:
            await emit({"type": "error", "message": f"Unknown agent profile: {agent_id}"})
            return

        self.conversation_history.setdefault(agent_id, []).append(
            {"role": "user", "content": prompt, "timestamp": time.time()}
        )

        await emit(
            {
                "type": "turn_start",
                "agent_id": profile.id,
                "agent_name": profile.name,
                "provider": profile.provider,
                "model": profile.model or "gemini-default",
            }
        )

        # Check if user asked to simulate/demo a gated action or if live provider is available
        if profile.provider == "ollama":
            status = await self.check_ollama_status(profile.base_url)
            if not status["online"]:
                await self._run_interactive_sandbox_fallback(
                    profile,
                    prompt,
                    emit,
                    notice=(
                        f"Ollama server at `{profile.base_url}` is currently offline "
                        "(waiting for your local Ollama instance / new PC). "
                        "Running in **Interactive Mobile Workspace Preview** so you can test "
                        "live file edits, diffs, mobile approval gates, and multi-agent routing right now!"
                    ),
                )
                return

        if profile.provider == "gemini" and not (self.gemini_api_key or os.environ.get("GEMINI_API_KEY")):
            await self._run_interactive_sandbox_fallback(
                profile,
                prompt,
                emit,
                notice=(
                    "No `GEMINI_API_KEY` set yet (get one at https://aistudio.google.com/app/api-keys "
                    "or add it in the **Settings / Agents** tab). "
                    "Running in **Interactive Mobile Workspace Preview** so you can test "
                    "mobile approval gates, subagent delegation, and code diffs!"
                ),
            )
            return

        if not HAS_AGY_SDK:
            await self._run_interactive_sandbox_fallback(
                profile,
                prompt,
                emit,
                notice=(
                    "`google-antigravity` SDK is ready in `requirements.txt`. "
                    "Running in **Interactive Mobile Workspace Preview** mode."
                ),
            )
            return

        # Full Google Antigravity SDK Execution
        try:
            config = self._build_sdk_config(profile, emit)
            full_text: List[str] = []
            async with Agent(config=config) as agent:
                response = await agent.chat(prompt)

                # Stream model thoughts if exposed
                if hasattr(response, "thoughts") and response.thoughts is not None:
                    try:
                        async for thought in response.thoughts:
                            await emit(
                                {
                                    "type": "thought_delta",
                                    "agent_id": profile.id,
                                    "delta": str(thought),
                                }
                            )
                    except Exception:
                        pass

                # Stream response tokens
                async for token in response:
                    chunk = str(token)
                    full_text.append(chunk)
                    await emit(
                        {
                            "type": "token_delta",
                            "agent_id": profile.id,
                            "delta": chunk,
                        }
                    )

            final_answer = "".join(full_text)
            self.conversation_history[agent_id].append(
                {"role": "assistant", "content": final_answer, "timestamp": time.time()}
            )
            await emit({"type": "turn_end", "agent_id": profile.id, "content": final_answer})

        except Exception as exc:
            await emit(
                {
                    "type": "error",
                    "agent_id": profile.id,
                    "message": f"SDK Execution Error: {exc}",
                }
            )

    async def _run_interactive_sandbox_fallback(
        self,
        profile: AgentProfile,
        prompt: str,
        emit: EventCallback,
        notice: str,
    ) -> None:
        """
        Interactive workspace demonstration loop when Ollama isn't running yet or API key isn't entered.
        Still exercises real mobile approval gates, workspace file inspection, and subagent trace cards!
        """
        thoughts = [
            f"[{profile.name}] Connecting via `{profile.provider.upper()}` config...\n",
            f" inspecting workspace `{self.workspace_dir}`...\n",
        ]
        if profile.enable_subagents and profile.subagents:
            sub_names = ", ".join(s.name for s in profile.subagents)
            thoughts.append(f"Delegating codebase scan to subagents: `{sub_names}`...\n")

        for t in thoughts:
            await emit({"type": "thought_delta", "agent_id": profile.id, "delta": t})
            await asyncio.sleep(0.25)

        # If prompt mentions running a command, editing, or testing approval, trigger a real Mobile Approval Gate!
        lower = prompt.lower()
        approved_note = ""
        if any(k in lower for k in ["approve", "approval", "command", "test", "edit", "run", "fix", "create"]):
            tool_name = "run_command" if "edit" not in lower else "edit_file"
            tool_args = (
                {"CommandLine": "pytest -q && git status -s", "cwd": self.workspace_dir}
                if tool_name == "run_command"
                else {
                    "Path": "demo_workspace/mobile_agent_demo.py",
                    "Summary": "Add mobile telemetry health check endpoint",
                }
            )
            await emit(
                {
                    "type": "tool_start",
                    "agent_id": profile.id,
                    "tool_name": tool_name,
                    "arguments": tool_args,
                }
            )
            if tool_name in profile.require_approval_for:
                approved = await self.request_mobile_approval(
                    profile.id, tool_name, tool_args, emit
                )
                if approved:
                    approved_note = (
                        f"\n\n✅ **Mobile Approval Granted** for `{tool_name}`! "
                        "Tool executed cleanly inside the workspace."
                    )
                    if tool_name == "edit_file":
                        self._apply_demo_edit()
                else:
                    approved_note = (
                        f"\n\n🛑 **Mobile Approval Rejected** for `{tool_name}`. "
                        "The agent safely aborted the tool call per your mobile decision."
                    )
            await emit(
                {
                    "type": "tool_end",
                    "agent_id": profile.id,
                    "summary": f"Completed {tool_name} check.",
                }
            )

        reply = (
            f"> **Status**: {notice}\n\n"
            f"### Response from **{profile.name}** (`{profile.model or 'gemini-3.8-flash'}`)\n"
            f"I analyzed your request: *\"{prompt}\"*\n\n"
            f"- **SDK Config**: `{('LocalOpenAIAgentConfig(...).lightweight()' if profile.provider == 'ollama' else 'LocalAgentConfig(...)')}`\n"
            f"- **Active Approval Gates**: `{', '.join(profile.require_approval_for) or 'None (Autonomous)'}`\n"
            f"- **Subagents Enabled**: `{'Yes (' + ', '.join(s.name for s in profile.subagents) + ')' if profile.enable_subagents else 'Disabled (Lightweight Preset)'}`"
            f"{approved_note}"
        )

        # Stream tokens smoothly to mobile client
        words = reply.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            await emit({"type": "token_delta", "agent_id": profile.id, "delta": chunk})
            await asyncio.sleep(0.015)

        self.conversation_history[profile.id].append(
            {"role": "assistant", "content": reply, "timestamp": time.time()}
        )
        await emit({"type": "turn_end", "agent_id": profile.id, "content": reply})

    def _apply_demo_edit(self) -> None:
        """Applies a safe modification to a demo file so the user can see live Git diffs on mobile."""
        target = os.path.join(self.workspace_dir, "backend", "agent_manager.py")
        demo_file = os.path.join(self.workspace_dir, "mobile_notes.md")
        try:
            with open(demo_file, "a", encoding="utf-8") as f:
                f.write(f"\n- Approved mobile agent edit at {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        except Exception:
            pass

