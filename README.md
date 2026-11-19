# OwnStack — Antigravity Multi-Agent Mobile & Desktop IDE

<p align="center">
  <img src="frontend/ownstack-banner.jpeg" alt="OwnStack Antigravity IDE Banner" width="420" />
</p>

An open-source, mobile-first and desktop-ready AI Development Environment powered by the **Google Antigravity Python SDK (`google-antigravity`)**, **Ollama (`LocalOpenAIAgentConfig`)**, and **Gemini (`LocalAgentConfig`)**.

Work on your codebase from your phone (over Wi-Fi, 4G/5G via Tailscale, or 24/7 Cloud Hosting on Render) or from your desktop browser with autonomous coding agents, mobile tool approval gates, a 1-click GitHub repository switcher, a split-screen file & diff editor, and full Git source control.

---

## Key Features

1. **Dual-Engine Multi-Agent Runtime (`Ollama` ↔ `Gemini`)**
   - **1-Tap Engine Switcher**: Toggle instantly between **Ollama** (`LocalOpenAIAgentConfig(...).lightweight()`) and **Gemini** (`LocalAgentConfig(...)` with hierarchical `code_researcher`, `fact_checker`, and `test_specialist` subagents) from the top navigation bar.
   - **Custom Agent Profiles**: Create unlimited specialized agent personas with custom models (`gemma4:26b`, `qwen2.5-coder`, or your own fine-tuned checkpoints), custom instructions, and per-tool approval gates.
   - **LiteRT On-Device Ready**: Supports `LiteRTAgentConfig` for zero-latency local `.litertlm` checkpoints on GPU/NPU.

2. **Mobile & Desktop Tool Approval Gates**
   - Intercepts sensitive agent actions (`run_command`, `edit_file`, `create_file`) via the Antigravity SDK's `policy.ask_user(...)` and `@hooks.pre_tool_call_decide`.
   - Pauses agent execution and opens a native `<dialog>` permission prompt on your phone or PC so you can **Approve & Run** or **Deny** every command or file modification.

3. **1-Click GitHub Repository Browser & Workspace Switcher**
   - Browse your GitHub repositories (`@RealRiga` or any GitHub username + optional Personal Access Token for private repos) in the **GitHub Repos (`<>`)** tab.
   - Click **"Open in IDE →"** on any repository to automatically clone it and switch the entire IDE workspace into that project.

4. **Responsive Explorer, Code Editor & Unified Diff Viewer**
   - Side-by-side split-screen file tree and code/diff editor on PC, and a touch-optimized stacked view on mobile.
   - Inspect unified diffs (`+` / `-` syntax highlighting) and save edits directly to disk.

5. **Full Git Source Control**
   - Check working tree status, stage files (`git add -A`), commit changes, switch or create branches, and inspect commit history.

6. **Professional Light (White Default) & Dark Theme**
   - Opens in a clean white editorial theme by default with a 1-tap Sun/Moon dark mode toggle in the top header.

---

## Quick Start (Option 1: Run on Your Local PC)

```bash
cd /home/realriga/development/me/antigravity-mobile-ide

# 1. Create virtual environment & install dependencies (first time only)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Copy and configure your .env file
cp .env.example .env

# 3. Launch the local server (prints both your Local Wi-Fi URL and Tailscale 4G/5G URL)
./deploy/start-local-mobile.sh
```

### Auto-Start on PC Boot (Systemd Service)
```bash
mkdir -p ~/.config/systemd/user
cp /home/realriga/development/me/antigravity-mobile-ide/deploy/antigravity-mobile.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now antigravity-mobile.service
```

---

## Cloud Deployment (Option 2: 24/7 Access When Your PC is Off)

### 1. Deploy Free on Render.com (`render.yaml`)
1. Open **[https://dashboard.render.com/blueprint/new?repo=https://github.com/RealRiga/antigravity-mobile-ide](https://dashboard.render.com/blueprint/new?repo=https://github.com/RealRiga/antigravity-mobile-ide)**
2. Set your environment variables:
   - `GEMINI_API_KEY`: Your key from [Google AI Studio](https://aistudio.google.com/app/api-keys) (`AIzaSy...`) or Vertex Express Mode (`AQ....`).
   - `AGY_ACCESS_PIN`: A secret PIN you choose (e.g., `482910`) to lock your cloud IDE.
3. Click **Apply**. Your permanent cloud URL (`https://antigravity-mobile-ide.onrender.com`) will build automatically from the [`Dockerfile`](Dockerfile).

### 2. Keep Render Awake 24/7 with Cron-Job.org
Render's free tier sleeps after 15 minutes of inactivity. To keep it awake 24/7:
- Create a free monitor on **[https://cron-job.org](https://cron-job.org)** or **[https://uptimerobot.com](https://uptimerobot.com)**
- Set the URL to:
  ```text
  https://antigravity-mobile-ide.onrender.com/health
  ```
- Set the interval to **Every 10 minutes**.

---

## Troubleshooting Common API Key & Setup Questions

### Why did I see `403 SERVICE_DISABLED: Agent Platform API (aiplatform.googleapis.com) has not been used in project...`?
- **Cause:** API keys starting with `AQ....` use **Google Cloud Vertex AI / Agent Platform Express Mode** (`aiplatform.googleapis.com`). If your Google Cloud project is brand new, Google requires you to click **"Enable"** on the Vertex AI API once in the Google Cloud Console.
- **How to Fix:**
  1. **1-Click Enable:** Open the activation link shown in the error message (for project `308402531123`: `https://console.developers.google.com/apis/api/aiplatform.googleapis.com/overview?project=308402531123`) and click **Enable**, then wait 60 seconds.
  2. **Or Use a Standard AI Studio Key (`AIzaSy...`):** Go to [https://aistudio.google.com/app/api-keys](https://aistudio.google.com/app/api-keys), create a standard Gemini API key (`AIzaSy...`), and paste it into the **Agents & Config** tab (or Render's `GEMINI_API_KEY` variable).

---

## Documentation & Architecture

For a deep dive into how the backend, frontend, WebSocket protocol, approval gates, and multi-agent orchestration work, read **[DOCS.md](DOCS.md)**.

## License

Released under the **[MIT License](LICENSE)**.
