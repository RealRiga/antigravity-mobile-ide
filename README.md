# Antigravity Mobile Companion (PWA + Multi-Agent Backend)

A mobile-first Progressive Web Application (PWA) and FastAPI backend that lets you manage your codebase, orchestrate **multiple AI agents** (both **Ollama local models** via `LocalOpenAIAgentConfig` and **Gemini models** via `LocalAgentConfig`), review diffs, approve/reject tool calls, and run Git operations from your phone.

## Features

1. **Multi-Agent & Ollama Support (`google-antigravity` SDK)**
   - **Ollama / Local OpenAI Server (`LocalOpenAIAgentConfig`)**: Connect to your local or remote Ollama instance (e.g. `http://localhost:11434/v1` with `gemma4:26b`, `qwen2.5-coder`, `llama3.3`, or your own fine-tuned models once your new PC arrives!). Uses `.lightweight()` preset for optimized local context & coding tools.
   - **Gemini API (`LocalAgentConfig`)**: Use Google AI Studio API keys (`GEMINI_API_KEY`) with full subagent orchestration (`researcher`, `coder`, `reviewer`, `test_runner`).
   - **LiteRT On-Device (`LiteRTAgentConfig`)**: Ready for `.litertlm` local checkpoints on GPU/NPU.
   - **Multi-Agent Profiles**: Create, switch, and run specialized agents (e.g., *Architect*, *Code Writer*, *Bug Hunter*, *Test Engineer*) or let the root agent delegate to subagents (`SubagentConfig`).

2. **Real-Time Agent Chat & Streaming Execution View**
   - WebSocket streaming for model reasoning (`response.thoughts`), token-by-token responses, and live tool call telemetry (`pre_tool_call_decide`, `post_tool_call`).

3. **Mobile Approval Gates**
   - Intercepts sensitive tool calls (`run_command`, `edit_file`, `create_file`) via `policy.ask_user(...)` and `pre_tool_call_decide` hooks.
   - Pushes an interactive **Approve / Reject** modal (`<dialog>`) and card directly to your phone screen before execution proceeds.

4. **File Tree Explorer & Diff Viewer**
   - Browse workspace files, view syntax-highlighted source code, inspect side-by-side / unified file changes, and edit files on the go.

5. **Git Status, Diff, Commit & Branch Controls**
   - View modified/staged/untracked files, inspect `git diff`, stage/unstage changes, switch or create branches, and commit directly from mobile.

## Quick Start

```bash
cd /home/realriga/development/me/antigravity-mobile-ide

# 1. Create and populate Python virtual environment
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Start the server (binds to 0.0.0.0:8000 so you can access it over Wi-Fi / Tailscale)
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Then open **`http://localhost:8000`** (or your PC's LAN/Tailscale IP `http://<your-pc-ip>:8000`) on your phone!

# antigravity-mobile-ide
