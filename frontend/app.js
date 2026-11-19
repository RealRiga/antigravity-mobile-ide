/**
 * OwnStack — Antigravity Multi-Agent IDE Frontend Controller
 * - OwnStack Branding & Favicon
 * - Automatic Access PIN Modal (Prompts whenever server requires AGY_ACCESS_PIN or returns 401/1008)
 * - Left IDE Sidebar Navigation (Chat, Explorer & Diff, GitHub Repos, Source Control, Agents)
 * - Enter-to-send keyboard support (Shift+Enter for new line)
 * - 1-Click GitHub Repository Browser & Seamless Workspace Switcher
 */

const state = {
  agents: [],
  activeAgentId: "gemini-lead-architect",
  lastOllamaAgentId: "ollama-coder",
  lastGeminiAgentId: "gemini-lead-architect",
  welcomeEngine: "gemini",
  ws: null,
  pendingChatQueue: [],
  currentApprovalId: null,
  currentFilePath: null,
  currentFileDiff: "",
  showingDiff: false,
  activeTurnCard: null,
  isGenerating: false,
  accessPin: localStorage.getItem("agy_access_pin") || "",
  githubToken: localStorage.getItem("agy_github_token") || "",
  pinRequiredByServer: false,
};

// DOM References
const welcomeScreen = document.getElementById("welcome-screen");
const btnGetStarted = document.getElementById("btn-get-started");
const btnShowWelcome = document.getElementById("btn-show-welcome");
const welcomePickGemini = document.getElementById("welcome-pick-gemini");
const welcomePickOllama = document.getElementById("welcome-pick-ollama");
const welcomePinBox = document.getElementById("welcome-pin-box");
const welcomePinInput = document.getElementById("welcome-pin-input");
const btnWelcomePin = document.getElementById("btn-welcome-pin");

const pinDialog = document.getElementById("pin-dialog");
const modalPinInput = document.getElementById("modal-pin-input");
const btnOpenPinModal = document.getElementById("btn-open-pin-modal");
const btnCancelPin = document.getElementById("btn-cancel-pin");

const headerWorkspaceName = document.getElementById("header-workspace-name");
const btnActiveRepoPill = document.getElementById("btn-active-repo-pill");

const activeAgentSelect = document.getElementById("active-agent-select");
const ollamaStatusPill = document.getElementById("ollama-status-pill");
const chatMessages = document.getElementById("chat-messages");
const chatThread = document.getElementById("chat-thread");
const chatEmptyState = document.getElementById("chat-empty-state");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const btnSendChat = document.getElementById("btn-send-chat");
const chatAgentProviderBadge = document.getElementById("chat-agent-provider-badge");
const chatAgentRole = document.getElementById("chat-agent-role");
const chatSubagentCount = document.getElementById("chat-subagent-count");

const btnToggleOllama = document.getElementById("btn-toggle-ollama");
const btnToggleGemini = document.getElementById("btn-toggle-gemini");
const btnThemeToggle = document.getElementById("btn-theme-toggle");
const btnWelcomeTheme = document.getElementById("btn-welcome-theme");

const approvalBanner = document.getElementById("approval-banner");
const approvalBannerText = document.getElementById("approval-banner-text");
const approvalDialog = document.getElementById("approval-dialog");
const approvalAgentName = document.getElementById("approval-agent-name");
const approvalToolName = document.getElementById("approval-tool-name");
const approvalToolArgs = document.getElementById("approval-tool-args");

const newAgentDialog = document.getElementById("new-agent-dialog");

// 1. Intercept fetch to attach X-AGY-PIN and automatically open PIN dialog on 401 Unauthorized
const origFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (state.accessPin) {
    headers.set("X-AGY-PIN", state.accessPin);
  }
  const response = await origFetch(url, { ...options, headers });
  if (response.status === 401 && !String(url).includes("/health")) {
    promptForAccessPin();
  }
  return response;
};

function setAccessPin(newPin) {
  state.accessPin = (newPin || "").trim();
  try {
    localStorage.setItem("agy_access_pin", state.accessPin);
  } catch (e) {}
  const settingPin = document.getElementById("setting-access-pin");
  if (settingPin) settingPin.value = state.accessPin;
  if (welcomePinInput) welcomePinInput.value = state.accessPin;
  if (modalPinInput) modalPinInput.value = state.accessPin;
}

function promptForAccessPin() {
  if (welcomeScreen && !welcomeScreen.classList.contains("hidden")) {
    if (welcomePinBox) welcomePinBox.classList.remove("hidden");
    if (welcomePinInput) welcomePinInput.focus();
    return;
  }
  if (pinDialog && !pinDialog.open) {
    if (modalPinInput) modalPinInput.value = state.accessPin;
    pinDialog.showModal();
  }
}

if (btnOpenPinModal) {
  btnOpenPinModal.addEventListener("click", () => {
    if (modalPinInput) modalPinInput.value = state.accessPin;
    if (!pinDialog.open) pinDialog.showModal();
  });
}

if (btnWelcomePin) {
  btnWelcomePin.addEventListener("click", () => {
    if (welcomePinBox) {
      welcomePinBox.classList.remove("hidden");
      if (welcomePinInput) welcomePinInput.focus();
    }
  });
}

if (btnCancelPin) {
  btnCancelPin.addEventListener("click", () => {
    pinDialog.close("cancel");
  });
}

if (pinDialog) {
  pinDialog.addEventListener("close", async () => {
    const action = pinDialog.returnValue;
    pinDialog.returnValue = "";
    if (action !== "unlock") return;
    if (modalPinInput && modalPinInput.value.trim()) {
      setAccessPin(modalPinInput.value.trim());
      if (state.ws) state.ws.close();
      await refreshHealth();
      await loadAgents();
      connectWebSocket();
    }
  });
}

// 2. Welcome Page / Get Started Onboarding Flow
if (localStorage.getItem("agy_onboarded") === "true") {
  welcomeScreen.classList.add("hidden");
}

welcomePickGemini.addEventListener("click", () => {
  state.welcomeEngine = "gemini";
  welcomePickGemini.classList.add("ring-2", "ring-indigo-500/80");
  welcomePickOllama.classList.remove("ring-2", "ring-emerald-500/80");
});

welcomePickOllama.addEventListener("click", () => {
  state.welcomeEngine = "ollama";
  welcomePickOllama.classList.add("ring-2", "ring-emerald-500/80");
  welcomePickGemini.classList.remove("ring-2", "ring-indigo-500/80");
});

btnGetStarted.addEventListener("click", async () => {
  if (welcomePinInput && welcomePinInput.value.trim()) {
    setAccessPin(welcomePinInput.value.trim());
  }
  localStorage.setItem("agy_onboarded", "true");
  welcomeScreen.classList.add("hidden");
  await refreshHealth();
  await loadAgents();
  switchEngineProvider(state.welcomeEngine);
  connectWebSocket();
});

btnShowWelcome.addEventListener("click", () => {
  welcomeScreen.classList.remove("hidden");
});

// 3. White Default <-> Dark Mode Theme Toggle (`dark-mode-toggle` compliant)
const SUN_PATH = "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z";
const MOON_PATH = "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z";

function getCurrentColorScheme() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const content = meta ? meta.content : "light";
  if (content === "dark" || content === "light") return content;
  return "light";
}

function applyColorScheme(scheme) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = scheme;
  }
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.content = scheme === "dark" ? "#0d0d0f" : "#ffffff";
  }
  const iconPath = scheme === "dark" ? SUN_PATH : MOON_PATH;
  document.querySelectorAll("#theme-toggle-svg path, #welcome-theme-svg path").forEach((p) => {
    p.setAttribute("d", iconPath);
  });
  try {
    localStorage.setItem("color-scheme", scheme);
  } catch (e) {}
}

applyColorScheme(getCurrentColorScheme());

function toggleTheme() {
  const next = getCurrentColorScheme() === "dark" ? "light" : "dark";
  applyColorScheme(next);
}

btnThemeToggle.addEventListener("click", toggleTheme);
if (btnWelcomeTheme) btnWelcomeTheme.addEventListener("click", toggleTheme);

window.addEventListener("storage", (e) => {
  if (e.key === "color-scheme" && e.newValue) {
    applyColorScheme(e.newValue);
  }
});

// 4. Segmented Ollama <-> Gemini Engine Switcher
function switchEngineProvider(targetProvider) {
  const matching = state.agents.filter((a) => a.provider === targetProvider);
  if (matching.length === 0) return;

  if (targetProvider === "ollama") {
    const pick = matching.find((a) => a.id === state.lastOllamaAgentId) || matching[0];
    state.activeAgentId = pick.id;
    state.lastOllamaAgentId = pick.id;
  } else if (targetProvider === "gemini") {
    const pick = matching.find((a) => a.id === state.lastGeminiAgentId) || matching[0];
    state.activeAgentId = pick.id;
    state.lastGeminiAgentId = pick.id;
  }

  renderAgentSelect();
  updateActiveAgentStrip();
  renderAgentsRoster();
}

btnToggleOllama.addEventListener("click", () => switchEngineProvider("ollama"));
btnToggleGemini.addEventListener("click", () => switchEngineProvider("gemini"));

const newAgentProviderSelect = document.getElementById("new-agent-provider");
const newAgentModelInput = document.getElementById("new-agent-model");
if (newAgentProviderSelect && newAgentModelInput) {
  newAgentProviderSelect.addEventListener("change", () => {
    if (newAgentProviderSelect.value === "gemini") {
      newAgentModelInput.value = "";
      newAgentModelInput.placeholder = "Blank for SDK default (gemini-3.8-flash)";
    } else if (newAgentProviderSelect.value === "ollama") {
      newAgentModelInput.value = "gemma4:26b";
      newAgentModelInput.placeholder = "e.g., gemma4:26b or qwen2.5-coder:7b";
    } else {
      newAgentModelInput.value = "~/.litert-lm/models/gemma4-26b/model.litertlm";
    }
  });
}

// 5. Left Sidebar Tab Navigation
function activateTab(targetTab) {
  document.querySelectorAll(".nav-tab-btn").forEach((b) => {
    b.classList.remove("text-primary", "bg-zinc-500/10", "font-semibold");
    b.classList.add("text-secondary");
    if (b.dataset.tab === targetTab) {
      b.classList.add("text-primary", "bg-zinc-500/10", "font-semibold");
      b.classList.remove("text-secondary");
    }
  });

  ["chat", "files", "github", "git", "agents", "docs"].forEach((tab) => {
    const el = document.getElementById(`view-${tab}`);
    if (!el) return;
    if (tab === targetTab) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  if (targetTab === "files") loadFileTree();
  if (targetTab === "github") {
    loadLocalWorkspaces();
    loadGitHubRepos();
  }
  if (targetTab === "git") loadGitStatus();
  if (targetTab === "agents") renderAgentsRoster();
  if (targetTab === "docs") loadInAppDocs("docs");
}

document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

if (btnActiveRepoPill) {
  btnActiveRepoPill.addEventListener("click", () => activateTab("github"));
}

// 6. Initialize Health, PIN Requirement Check, Agents & WebSocket
async function initApp() {
  setAccessPin(state.accessPin);
  const ghTokenInput = document.getElementById("github-token-input");
  if (ghTokenInput && state.githubToken) {
    ghTokenInput.value = state.githubToken;
  }

  // Check public /health first to see if server requires AGY_ACCESS_PIN
  try {
    const pub = await origFetch("/health");
    const pubData = await pub.json();
    state.pinRequiredByServer = Boolean(pubData.pin_required);
    if (state.pinRequiredByServer && !state.accessPin) {
      if (welcomePinBox) welcomePinBox.classList.remove("hidden");
      if (welcomeScreen.classList.contains("hidden")) {
        promptForAccessPin();
      }
    }
  } catch (e) {}

  await refreshHealth();
  await loadAgents();
  connectWebSocket();
}

async function refreshHealth() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return;
    const data = await res.json();
    if (data.workspace_dir && headerWorkspaceName) {
      const parts = data.workspace_dir.split("/").filter(Boolean);
      headerWorkspaceName.textContent = parts[parts.length - 1] || "workspace";
    }
    const geminiState = data.has_gemini_key ? "Gemini Ready" : "Gemini";
    if (ollamaStatusPill) {
      if (data.ollama && data.ollama.online) {
        ollamaStatusPill.textContent = `Ollama (${data.ollama.models.length}) • ${geminiState}`;
      } else {
        ollamaStatusPill.textContent = `${geminiState} • Ollama Standby`;
      }
    }
  } catch (err) {}
}

async function loadAgents() {
  const res = await fetch("/api/agents");
  if (!res.ok) return;
  const data = await res.json();
  state.agents = data.agents || [];
  if (!state.agents.find((a) => a.id === state.activeAgentId) && state.agents.length > 0) {
    state.activeAgentId = state.agents[0].id;
  }
  renderAgentSelect();
  updateActiveAgentStrip();
  renderAgentsRoster();
}

function renderAgentSelect() {
  if (!activeAgentSelect) return;
  activeAgentSelect.innerHTML = "";
  state.agents.forEach((agent) => {
    const opt = document.createElement("option");
    opt.value = agent.id;
    opt.textContent = agent.name;
    if (agent.id === state.activeAgentId) opt.selected = true;
    activeAgentSelect.appendChild(opt);
  });
}

if (activeAgentSelect) {
  activeAgentSelect.addEventListener("change", () => {
    state.activeAgentId = activeAgentSelect.value;
    const picked = state.agents.find((a) => a.id === state.activeAgentId);
    if (picked) {
      if (picked.provider === "ollama") state.lastOllamaAgentId = picked.id;
      if (picked.provider === "gemini") state.lastGeminiAgentId = picked.id;
    }
    updateActiveAgentStrip();
    renderAgentsRoster();
  });
}

function updateActiveAgentStrip() {
  const agent = state.agents.find((a) => a.id === state.activeAgentId);
  if (!agent) return;

  btnToggleOllama.classList.remove("is-active");
  btnToggleGemini.classList.remove("is-active");
  if (agent.provider === "ollama") {
    btnToggleOllama.classList.add("is-active");
    if (chatAgentProviderBadge) chatAgentProviderBadge.textContent = "OLLAMA";
  } else if (agent.provider === "gemini") {
    btnToggleGemini.classList.add("is-active");
    if (chatAgentProviderBadge) chatAgentProviderBadge.textContent = "GEMINI";
  } else {
    if (chatAgentProviderBadge) chatAgentProviderBadge.textContent = "LITERT";
  }

  if (chatAgentRole) chatAgentRole.textContent = agent.role;
  const subCount = agent.enable_subagents && agent.subagents ? agent.subagents.length : 0;
  const gateCount = (agent.require_approval_for || []).length;
  if (chatSubagentCount) {
    chatSubagentCount.textContent =
      subCount > 0 ? `${subCount} Subagents • ${gateCount} Gates` : `${gateCount} Gates`;
  }
}

// 7. WebSocket Streaming & Mobile Approval Gates
function connectWebSocket() {
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const pinQuery = state.accessPin ? `?pin=${encodeURIComponent(state.accessPin)}` : "";
  const ws = new WebSocket(`${proto}://${window.location.host}/ws/chat${pinQuery}`);
  state.ws = ws;

  ws.onopen = () => {
    while (state.pendingChatQueue.length > 0) {
      const payload = state.pendingChatQueue.shift();
      ws.send(JSON.stringify(payload));
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleStreamEvent(msg);
  };

  ws.onclose = (ev) => {
    state.ws = null;
    setGeneratingState(false);
    if (ev.code === 1008) {
      promptForAccessPin();
      return;
    }
    setTimeout(connectWebSocket, 2500);
  };
}

const SEND_ARROW_SVG = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" /></svg>`;
const RUNNING_SPINNER_SVG = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path></svg>`;

function setGeneratingState(running) {
  state.isGenerating = Boolean(running);
  if (btnSendChat) {
    btnSendChat.disabled = state.isGenerating;
    btnSendChat.innerHTML = state.isGenerating ? RUNNING_SPINNER_SVG : SEND_ARROW_SVG;
    if (state.isGenerating) {
      btnSendChat.classList.add("opacity-60", "cursor-not-allowed");
    } else {
      btnSendChat.classList.remove("opacity-60", "cursor-not-allowed");
    }
  }
  document.querySelectorAll(".quick-prompt-btn").forEach((b) => {
    b.disabled = state.isGenerating;
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatSimpleMarkdown(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong class='font-semibold text-primary'>$1</strong>");
  safe = safe.replace(
    /`([^`]+)`/g,
    "<code class='pro-pill px-1.5 py-0.5 rounded-md text-[11px] font-mono'>$1</code>"
  );
  safe = safe.replace(/\n/g, "<br/>");
  return safe;
}

function handleStreamEvent(msg) {
  if (msg.type === "turn_start") {
    setGeneratingState(true);
    if (chatEmptyState) chatEmptyState.classList.add("hidden");
    const card = document.createElement("div");
    card.className = "space-y-2.5 py-2";
    const isOllama = msg.provider === "ollama";
    card.innerHTML = `
      <div class="flex items-center gap-2 text-xs">
        <img src="/static/ownstack-logo.jpeg" alt="OwnStack" class="w-5 h-5 rounded-md object-cover border pro-border" />
        <span class="font-semibold text-primary">${escapeHtml(msg.agent_name)}</span>
        <span class="font-mono text-tertiary text-[11px]">${escapeHtml(msg.model)}</span>
        <span class="turn-running-pill inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 text-[10px] font-medium">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
          <span>Thinking...</span>
        </span>
      </div>
      <div class="pl-7 space-y-2.5">
        <details class="thought-box hidden bg-elevated border pro-border rounded-xl px-3 py-2 text-[11px] text-secondary">
          <summary class="cursor-pointer font-medium text-secondary select-none">Thinking &amp; Subagent Trace</summary>
          <div class="thought-content font-mono whitespace-pre-wrap pt-1.5 text-tertiary"></div>
        </details>
        <div class="tool-list space-y-1.5"></div>
        <div class="response-content text-sm text-primary leading-relaxed"></div>
      </div>
    `;
    chatThread.appendChild(card);
    state.activeTurnCard = {
      el: card,
      rawText: "",
      runningPill: card.querySelector(".turn-running-pill"),
      thoughtBox: card.querySelector(".thought-box"),
      thoughtContent: card.querySelector(".thought-content"),
      toolList: card.querySelector(".tool-list"),
      responseContent: card.querySelector(".response-content"),
    };
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (msg.type === "thought_delta" && state.activeTurnCard) {
    state.activeTurnCard.thoughtBox.classList.remove("hidden");
    state.activeTurnCard.thoughtContent.textContent += msg.delta;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (msg.type === "tool_start" && state.activeTurnCard) {
    const badge = document.createElement("div");
    badge.className =
      "bg-elevated border pro-border rounded-xl px-3 py-2 text-[11px] font-mono flex items-center justify-between gap-2";
    badge.innerHTML = `
      <div class="truncate">
        <span class="text-primary font-semibold">${escapeHtml(msg.tool_name)}</span>
        <span class="text-tertiary ml-1.5">${escapeHtml(JSON.stringify(msg.arguments))}</span>
      </div>
      <span class="text-amber-600 font-medium text-[10px] shrink-0">Executing</span>
    `;
    state.activeTurnCard.toolList.appendChild(badge);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (msg.type === "approval_required") {
    state.currentApprovalId = msg.approval_id;
    approvalAgentName.textContent = msg.agent_id;
    approvalToolName.textContent = msg.tool_name;
    approvalToolArgs.textContent = JSON.stringify(msg.arguments, null, 2);
    approvalBannerText.textContent = `Permission needed: ${msg.tool_name}`;
    approvalBanner.classList.remove("hidden");
    if (!approvalDialog.open) {
      approvalDialog.showModal();
    }
  } else if (msg.type === "approval_resolved") {
    approvalBanner.classList.add("hidden");
    if (approvalDialog.open) {
      approvalDialog.close();
    }
  } else if (msg.type === "token_delta" && state.activeTurnCard) {
    state.activeTurnCard.rawText += msg.delta;
    state.activeTurnCard.responseContent.innerHTML = formatSimpleMarkdown(state.activeTurnCard.rawText);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (msg.type === "turn_end") {
    if (state.activeTurnCard && state.activeTurnCard.runningPill) {
      state.activeTurnCard.runningPill.remove();
    }
    state.activeTurnCard = null;
    setGeneratingState(false);
  } else if (msg.type === "error") {
    if (state.activeTurnCard && state.activeTurnCard.runningPill) {
      state.activeTurnCard.runningPill.remove();
    }
    state.activeTurnCard = null;
    setGeneratingState(false);
    const errEl = document.createElement("div");
    errEl.className =
      "bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs font-medium rounded-xl p-3";
    errEl.textContent = msg.message || "Error during agent turn";
    chatThread.appendChild(errEl);
  }
}

// Native <dialog> close handler per modern-web-guidance `dialog` rule
approvalDialog.addEventListener("close", async () => {
  const choice = approvalDialog.returnValue;
  approvalDialog.returnValue = "";
  if (!state.currentApprovalId) return;
  if (choice === "") return;

  const approved = choice === "approve";
  const approvalId = state.currentApprovalId;
  state.currentApprovalId = null;
  approvalBanner.classList.add("hidden");

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(
      JSON.stringify({
        type: "approval_decision",
        approval_id: approvalId,
        approved,
      })
    );
  } else {
    await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
  }
});

document.getElementById("btn-review-approval").addEventListener("click", () => {
  if (!approvalDialog.open) {
    approvalDialog.showModal();
  }
});

// 8. Send Chat Prompt + Enter Key Handler
function sendChatPrompt(promptText) {
  const text = promptText.trim();
  if (!text || state.isGenerating) return;

  if (state.pinRequiredByServer && !state.accessPin) {
    promptForAccessPin();
    return;
  }

  setGeneratingState(true);
  if (chatEmptyState) chatEmptyState.classList.add("hidden");

  const wrapper = document.createElement("div");
  wrapper.className = "flex justify-end";
  const userBubble = document.createElement("div");
  userBubble.className =
    "pro-pill rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-primary max-w-[85%]";
  userBubble.textContent = text;
  wrapper.appendChild(userBubble);
  chatThread.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const payload = {
    type: "chat",
    agent_id: state.activeAgentId,
    prompt: text,
  };

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  } else {
    state.pendingChatQueue.push(payload);
    connectWebSocket();
  }
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendChatPrompt(chatInput.value);
  chatInput.value = "";
  chatInput.style.height = "auto";
});

// Send on Enter (without Shift), allow new line with Shift+Enter
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChatPrompt(chatInput.value);
    chatInput.value = "";
    chatInput.style.height = "auto";
  }
});

document.querySelectorAll(".quick-prompt-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    sendChatPrompt(btn.dataset.quickPrompt);
  });
});

// 9. GitHub Repositories Browser & 1-Click Seamless Workspace Switching
async function loadLocalWorkspaces() {
  const container = document.getElementById("local-workspaces-list");
  if (!container) return;
  const res = await fetch("/api/workspaces");
  if (!res.ok) return;
  const data = await res.json();
  container.innerHTML = "";

  (data.workspaces || []).forEach((ws) => {
    const card = document.createElement("div");
    card.className = "pro-card rounded-2xl p-3.5 flex items-center justify-between gap-2";
    card.innerHTML = `
      <div class="min-w-0">
        <div class="text-xs font-semibold text-primary truncate font-mono">${escapeHtml(ws.name)}</div>
        <div class="text-[10px] text-tertiary truncate">${escapeHtml(ws.path)}</div>
      </div>
      <button type="button" class="text-xs px-3 py-1.5 rounded-full font-semibold shrink-0 ${
        ws.active ? "btn-primary-pro" : "pro-pill hover:opacity-80"
      }">
        ${ws.active ? "Active" : "Switch"}
      </button>
    `;
    card.querySelector("button").addEventListener("click", async () => {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_dir: ws.path }),
      });
      await refreshHealth();
      await loadLocalWorkspaces();
      activateTab("files");
    });
    container.appendChild(card);
  });
}

async function loadGitHubRepos() {
  const grid = document.getElementById("github-repos-grid");
  if (!grid) return;
  const userEl = document.getElementById("github-username-input");
  const tokenEl = document.getElementById("github-token-input");
  const username = (userEl ? userEl.value.trim() : "RealRiga") || "RealRiga";
  const token = tokenEl ? tokenEl.value.trim() : "";
  if (token) {
    state.githubToken = token;
    try {
      localStorage.setItem("agy_github_token", token);
    } catch (e) {}
  }

  grid.innerHTML = `<div class="text-xs text-tertiary col-span-2">Loading GitHub repositories for @${escapeHtml(username)}...</div>`;
  const url = `/api/github/repos?username=${encodeURIComponent(username)}${
    token ? `&token=${encodeURIComponent(token)}` : ""
  }`;
  const res = await fetch(url);
  if (!res.ok) return;
  const data = await res.json();
  grid.innerHTML = "";

  if (!data.repos || data.repos.length === 0) {
    grid.innerHTML = `<div class="text-xs text-tertiary col-span-2">No repositories found. Check the GitHub username or add a Personal Access Token.</div>`;
    return;
  }

  data.repos.forEach((repo) => {
    const isCurrent = data.active_workspace === repo.name;
    const card = document.createElement("div");
    card.className = "pro-card rounded-2xl p-4 flex flex-col justify-between gap-3 hover:border-emerald-500 transition";
    card.innerHTML = `
      <div class="space-y-1">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-primary font-mono truncate">${escapeHtml(repo.name)}</span>
          <span class="text-[10px] px-2 py-0.5 rounded-full pro-pill text-secondary shrink-0">${escapeHtml(repo.language)}</span>
        </div>
        <p class="text-[11px] text-secondary line-clamp-2">${escapeHtml(repo.description)}</p>
      </div>
      <div class="flex items-center justify-between pt-2 border-t pro-border">
        <span class="text-[10px] text-tertiary">Updated ${escapeHtml(repo.updated_at)}</span>
        <button type="button" class="text-xs px-3.5 py-1.5 rounded-full font-semibold ${
          isCurrent ? "btn-primary-pro" : "pro-pill hover:opacity-80"
        }">
          ${isCurrent ? "Active Workspace" : "Open in IDE →"}
        </button>
      </div>
    `;
    const btn = card.querySelector("button");
    btn.addEventListener("click", async () => {
      btn.textContent = "Cloning & Switching...";
      try {
        const cloneRes = await fetch("/api/git/clone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repo_url: repo.clone_url, folder_name: repo.name }),
        });
        const cloneData = await cloneRes.json();
        if (cloneRes.ok) {
          await refreshHealth();
          await loadLocalWorkspaces();
          activateTab("files");
        } else {
          alert(cloneData.detail || "Could not clone repository");
          btn.textContent = "Open in IDE →";
        }
      } catch (e) {
        btn.textContent = "Open in IDE →";
      }
    });
    grid.appendChild(card);
  });
}

const btnFetchGithub = document.getElementById("btn-fetch-github-repos");
if (btnFetchGithub) {
  btnFetchGithub.addEventListener("click", loadGitHubRepos);
}

// 10. File Explorer, Editor & Diff Viewer (Split-Screen on PC, Stack on Mobile)
async function loadFileTree() {
  const res = await fetch("/api/files");
  if (!res.ok) return;
  const data = await res.json();
  const pane = document.getElementById("file-tree-pane");
  pane.innerHTML = "";

  (data.files || []).forEach((f) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "w-full text-left pro-card rounded-xl px-3 py-2 hover:border-indigo-500 flex items-center justify-between gap-2 transition";
    row.innerHTML = `
      <div class="min-w-0">
        <div class="text-xs font-mono font-medium text-primary truncate">${escapeHtml(f.path)}</div>
        <div class="text-[10px] text-tertiary">${f.size} bytes</div>
      </div>
      ${
        f.modified
          ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">M</span>`
          : `<span class="text-xs text-tertiary">›</span>`
      }
    `;
    row.addEventListener("click", () => openFileInEditor(f.path));
    pane.appendChild(row);
  });
}

async function openFileInEditor(path) {
  const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) return;
  const data = await res.json();
  state.currentFilePath = data.path;
  state.currentFileDiff = data.diff || "";
  state.showingDiff = false;

  document.getElementById("current-file-label").textContent = data.path;
  if (window.innerWidth < 1024) {
    document.getElementById("file-tree-pane").classList.add("hidden");
  }
  const editorPane = document.getElementById("file-editor-pane");
  editorPane.classList.remove("hidden");
  editorPane.classList.add("flex");

  document.getElementById("btn-back-to-tree").classList.remove("hidden");
  document.getElementById("btn-save-file").classList.remove("hidden");
  document.getElementById("btn-toggle-file-diff").classList.remove("hidden");
  document.getElementById("btn-toggle-file-diff").textContent = "View Diff";

  const textarea = document.getElementById("file-editor-textarea");
  const diffViewer = document.getElementById("file-diff-viewer");
  textarea.classList.remove("hidden");
  diffViewer.classList.add("hidden");
  textarea.value = data.content;
}

document.getElementById("btn-back-to-tree").addEventListener("click", () => {
  document.getElementById("current-file-label").textContent = "Workspace Explorer";
  document.getElementById("file-tree-pane").classList.remove("hidden");
  if (window.innerWidth < 1024) {
    document.getElementById("file-editor-pane").classList.add("hidden");
  }
  document.getElementById("btn-back-to-tree").classList.add("hidden");
  loadFileTree();
});

document.getElementById("btn-save-file").addEventListener("click", async () => {
  if (!state.currentFilePath) return;
  const content = document.getElementById("file-editor-textarea").value;
  const res = await fetch("/api/files/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: state.currentFilePath, content }),
  });
  const data = await res.json();
  state.currentFileDiff = data.diff || "";
  const btn = document.getElementById("btn-save-file");
  btn.textContent = "Saved ✓";
  setTimeout(() => (btn.textContent = "Save File"), 1400);
});

document.getElementById("btn-toggle-file-diff").addEventListener("click", () => {
  const textarea = document.getElementById("file-editor-textarea");
  const diffViewer = document.getElementById("file-diff-viewer");
  const btn = document.getElementById("btn-toggle-file-diff");
  state.showingDiff = !state.showingDiff;

  if (state.showingDiff) {
    textarea.classList.add("hidden");
    diffViewer.classList.remove("hidden");
    btn.textContent = "Edit Code";
    renderDiffLines(diffViewer, state.currentFileDiff || "No changes compared to HEAD / initial snapshot.");
  } else {
    textarea.classList.remove("hidden");
    diffViewer.classList.add("hidden");
    btn.textContent = "View Diff";
  }
});

document.getElementById("btn-refresh-files").addEventListener("click", loadFileTree);

function renderDiffLines(container, diffText) {
  container.innerHTML = "";
  diffText.split("\n").forEach((line) => {
    const div = document.createElement("div");
    div.className = "px-2 py-0.5 rounded whitespace-pre";
    if (line.startsWith("+") && !line.startsWith("+++")) {
      div.classList.add("diff-add");
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      div.classList.add("diff-del");
    } else if (line.startsWith("@@")) {
      div.classList.add("diff-hunk");
    } else {
      div.classList.add("text-secondary");
    }
    div.textContent = line;
    container.appendChild(div);
  });
}

// 11. Git Status, Diff, Commit & Branch Controls
async function loadGitStatus() {
  const res = await fetch("/api/git/status");
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById("git-current-branch").textContent = data.branch || "main";

  const filesContainer = document.getElementById("git-changed-files");
  filesContainer.innerHTML = "";
  if (!data.files || data.files.length === 0) {
    filesContainer.innerHTML = `<div class="text-tertiary text-xs">Working tree clean.</div>`;
  } else {
    data.files.forEach((f) => {
      const el = document.createElement("div");
      el.className = "flex items-center justify-between bg-elevated border pro-border px-3 py-1.5 rounded-xl";
      el.innerHTML = `
        <span class="font-mono text-primary font-medium truncate">${escapeHtml(f.path)}</span>
        <span class="font-mono font-semibold text-amber-600 text-[11px]">${escapeHtml(f.status)}</span>
      `;
      filesContainer.appendChild(el);
    });
  }

  const diffBox = document.getElementById("git-diff-box");
  renderDiffLines(diffBox, data.diff && data.diff.trim() ? data.diff : "No uncommitted changes.");

  const commitsList = document.getElementById("git-commits-list");
  commitsList.innerHTML = "";
  (data.commits || []).forEach((c) => {
    const row = document.createElement("div");
    row.className = "bg-elevated border pro-border rounded-xl p-2.5 flex items-start justify-between gap-2";
    row.innerHTML = `
      <div class="min-w-0">
        <div class="text-primary font-medium truncate">${escapeHtml(c.message)}</div>
        <div class="text-[10px] text-tertiary">${escapeHtml(c.author)} • ${escapeHtml(c.time)}</div>
      </div>
      <span class="font-mono text-[11px] font-semibold text-secondary shrink-0">${escapeHtml(c.hash)}</span>
    `;
    commitsList.appendChild(row);
  });
}

document.getElementById("btn-refresh-git").addEventListener("click", loadGitStatus);

document.getElementById("btn-git-stage-all").addEventListener("click", async () => {
  await fetch("/api/git/stage", { method: "POST" });
  await loadGitStatus();
});

document.getElementById("btn-git-commit").addEventListener("click", async () => {
  const input = document.getElementById("git-commit-msg");
  if (!input.value.trim()) return;
  await fetch("/api/git/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: input.value.trim() }),
  });
  input.value = "";
  await loadGitStatus();
});

document.getElementById("btn-git-checkout").addEventListener("click", async () => {
  const branch = document.getElementById("git-new-branch-input").value.trim();
  if (!branch) return;
  await fetch("/api/git/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, create: false }),
  });
  await loadGitStatus();
});

document.getElementById("btn-git-create-branch").addEventListener("click", async () => {
  const branch = document.getElementById("git-new-branch-input").value.trim();
  if (!branch) return;
  await fetch("/api/git/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, create: true }),
  });
  document.getElementById("git-new-branch-input").value = "";
  await loadGitStatus();
});

const cloneBtn = document.getElementById("btn-git-clone");
if (cloneBtn) {
  cloneBtn.addEventListener("click", async () => {
    const repoInput = document.getElementById("git-clone-url-input");
    const repoUrl = repoInput.value.trim();
    if (!repoUrl) return;
    cloneBtn.textContent = "Cloning...";
    try {
      const res = await fetch("/api/git/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: repoUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        repoInput.value = "";
        await refreshHealth();
        await loadGitStatus();
        await loadFileTree();
      } else {
        alert(data.detail || "Clone failed");
      }
    } finally {
      cloneBtn.textContent = "Clone URL";
    }
  });
}

// 12. Multi-Agent Roster & Profile Creation
function renderAgentsRoster() {
  const list = document.getElementById("agents-roster-list");
  if (!list) return;
  list.innerHTML = "";
  state.agents.forEach((a) => {
    const card = document.createElement("div");
    card.className = "pro-card rounded-2xl p-4 space-y-2.5";
    const subNames = (a.subagents || []).map((s) => s.name).join(", ");
    const isOllama = a.provider === "ollama";
    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-primary">${escapeHtml(a.name)}</span>
            <span class="text-[10px] font-medium font-mono px-2 py-0.5 rounded-full pro-pill text-secondary">
              ${escapeHtml(a.provider.toUpperCase())}
            </span>
          </div>
          <p class="text-[11px] text-secondary mt-0.5">${escapeHtml(a.role)}</p>
        </div>
        <button type="button" data-select-agent="${escapeHtml(a.id)}"
          class="text-xs px-3.5 py-1.5 rounded-full font-semibold transition ${
            a.id === state.activeAgentId
              ? "btn-primary-pro"
              : "pro-pill hover:opacity-80"
          }">
          ${a.id === state.activeAgentId ? "Active" : "Select"}
        </button>
      </div>
      <div class="text-[11px] font-mono text-secondary bg-elevated border pro-border rounded-xl p-2.5 space-y-1">
        <div>Model: <span class="text-primary font-medium">${escapeHtml(a.model || "gemini-3.8-flash (SDK default)")}</span></div>
        ${isOllama ? `<div>Endpoint: <span class="text-primary">${escapeHtml(a.base_url)}</span></div>` : ""}
        <div>Approval Gates: <span class="text-primary">${escapeHtml((a.require_approval_for || []).join(", ") || "None")}</span></div>
        ${subNames ? `<div>Subagents: <span class="text-primary">${escapeHtml(subNames)}</span></div>` : ""}
      </div>
    `;
    card.querySelector(`[data-select-agent="${a.id}"]`).addEventListener("click", () => {
      state.activeAgentId = a.id;
      if (a.provider === "ollama") state.lastOllamaAgentId = a.id;
      if (a.provider === "gemini") state.lastGeminiAgentId = a.id;
      renderAgentSelect();
      updateActiveAgentStrip();
      renderAgentsRoster();
    });
    list.appendChild(card);
  });
}

function openNewAgentModal() {
  if (!newAgentDialog.open) newAgentDialog.showModal();
}
document.getElementById("btn-open-new-agent").addEventListener("click", openNewAgentModal);
document.getElementById("btn-add-agent-card").addEventListener("click", openNewAgentModal);
document.getElementById("btn-cancel-new-agent").addEventListener("click", () => {
  newAgentDialog.close("cancel");
});

newAgentDialog.addEventListener("close", async () => {
  const action = newAgentDialog.returnValue;
  newAgentDialog.returnValue = "";
  if (action !== "create") return;

  const name = document.getElementById("new-agent-name").value.trim();
  if (!name) return;
  const provider = document.getElementById("new-agent-provider").value;
  const model = document.getElementById("new-agent-model").value.trim();
  const role = document.getElementById("new-agent-role").value.trim();
  const instructions = document.getElementById("new-agent-instructions").value.trim();
  const gates = [];
  if (document.getElementById("new-agent-gate-cmd").checked) gates.push("run_command");
  if (document.getElementById("new-agent-gate-edit").checked) gates.push("edit_file", "create_file");

  const ollamaUrl = document.getElementById("setting-ollama-url").value.trim() || "http://localhost:11434";

  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      role,
      provider,
      model,
      base_url: `${ollamaUrl.replace(/\/$/, "")}/v1`,
      system_instructions: instructions,
      require_approval_for: gates,
      enable_subagents: provider === "gemini",
      use_lightweight: provider === "ollama",
    }),
  });
  const data = await res.json();
  if (data.agent) {
    state.activeAgentId = data.agent.id;
    if (data.agent.provider === "ollama") state.lastOllamaAgentId = data.agent.id;
    if (data.agent.provider === "gemini") state.lastGeminiAgentId = data.agent.id;
    await loadAgents();
  }
});

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  const ollamaUrl = document.getElementById("setting-ollama-url").value.trim();
  const geminiKey = document.getElementById("setting-gemini-key").value.trim();
  const pinInput = document.getElementById("setting-access-pin");
  if (pinInput) {
    setAccessPin(pinInput.value.trim());
  }
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ollama_base_url: ollamaUrl,
      gemini_api_key: geminiKey || null,
    }),
  });
  if (state.ws) {
    state.ws.close();
  }
  await refreshHealth();
  await loadAgents();
  connectWebSocket();
});

document.getElementById("btn-test-ollama").addEventListener("click", async () => {
  const ollamaUrl = document.getElementById("setting-ollama-url").value.trim();
  const res = await fetch(`/api/ollama/status?base_url=${encodeURIComponent(ollamaUrl)}`);
  const info = await res.json();
  alert(info.message);
  await refreshHealth();
});

// 13. In-App Documentation Viewer (DOCS.md & README.md)
let cachedDocsPayload = null;

async function loadInAppDocs(which = "docs") {
  const box = document.getElementById("docs-content-box");
  if (!box) return;
  const btnGuide = document.getElementById("btn-doc-tab-guide");
  const btnReadme = document.getElementById("btn-doc-tab-readme");

  if (btnGuide && btnReadme) {
    if (which === "docs") {
      btnGuide.className = "btn-primary-pro text-xs px-3.5 py-1.5 rounded-full";
      btnReadme.className = "pro-pill text-xs font-semibold px-3.5 py-1.5 rounded-full";
    } else {
      btnReadme.className = "btn-primary-pro text-xs px-3.5 py-1.5 rounded-full";
      btnGuide.className = "pro-pill text-xs font-semibold px-3.5 py-1.5 rounded-full";
    }
  }

  if (!cachedDocsPayload) {
    try {
      const res = await fetch("/api/docs");
      if (res.ok) {
        cachedDocsPayload = await res.json();
      }
    } catch (e) {}
  }

  const rawMd =
    (cachedDocsPayload && (which === "docs" ? cachedDocsPayload.docs : cachedDocsPayload.readme)) ||
    "Documentation file loaded.";
  box.innerHTML = renderDocMarkdown(rawMd);
}

function renderDocMarkdown(md) {
  const lines = md.split("\n");
  let html = "";
  let inCode = false;
  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      if (!inCode) {
        inCode = true;
        html += `<pre class="bg-zinc-950 text-zinc-100 rounded-xl p-3.5 font-mono text-[11px] overflow-x-auto my-2">`;
      } else {
        inCode = false;
        html += `</pre>`;
      }
      return;
    }
    if (inCode) {
      html += escapeHtml(line) + "\n";
      return;
    }
    if (line.startsWith("# ")) {
      html += `<h1 class="text-lg font-bold text-primary pt-2 pb-1 border-b pro-border">${formatSimpleMarkdown(line.slice(2))}</h1>`;
    } else if (line.startsWith("## ")) {
      html += `<h2 class="text-sm font-bold text-primary pt-3">${formatSimpleMarkdown(line.slice(3))}</h2>`;
    } else if (line.startsWith("### ")) {
      html += `<h3 class="text-xs font-semibold text-primary pt-2">${formatSimpleMarkdown(line.slice(4))}</h3>`;
    } else if (line.trim().startsWith("- ")) {
      html += `<div class="pl-3 flex items-start gap-2 text-xs text-secondary"><span class="text-primary">•</span><span>${formatSimpleMarkdown(line.trim().slice(2))}</span></div>`;
    } else if (line.trim() === "---") {
      html += `<hr class="pro-border my-2" />`;
    } else if (line.trim().length > 0 && !line.trim().startsWith("<")) {
      html += `<p class="text-xs text-secondary leading-relaxed">${formatSimpleMarkdown(line)}</p>`;
    }
  });
  return html;
}

const btnWelcomeDocs = document.getElementById("btn-welcome-docs");
if (btnWelcomeDocs) {
  btnWelcomeDocs.addEventListener("click", () => {
    localStorage.setItem("agy_onboarded", "true");
    welcomeScreen.classList.add("hidden");
    activateTab("docs");
  });
}

const btnDocGuide = document.getElementById("btn-doc-tab-guide");
const btnDocReadme = document.getElementById("btn-doc-tab-readme");
if (btnDocGuide) btnDocGuide.addEventListener("click", () => loadInAppDocs("docs"));
if (btnDocReadme) btnDocReadme.addEventListener("click", () => loadInAppDocs("readme"));

initApp();
