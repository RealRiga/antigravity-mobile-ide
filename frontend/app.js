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
  activeAgentId: "cloud-lead-architect",
  lastOllamaAgentId: "ollama-coder",
  lastCloudAgentId: "cloud-lead-architect",
  welcomeEngine: "cloud",
  ws: null,
  pendingChatQueue: [],
  currentApprovalId: null,
  currentFilePath: null,
  currentFileDiff: "",
  showingDiff: false,
  activeTurnCard: null,
  isGenerating: false,
  activeTab: "chat",
  currentWorkspaceName: "workspace",
  activeChatId: null,
  chatRetention: localStorage.getItem("ownstack_chat_retention") || "7d",
  obscureRepos: localStorage.getItem("agy_obscure_repos") === "true",
  accessPin: localStorage.getItem("agy_access_pin") || "",
  githubToken: localStorage.getItem("agy_github_token") || "",
  pinRequiredByServer: false,
};

// DOM References
const welcomeScreen = document.getElementById("welcome-screen");
const btnGetStarted = document.getElementById("btn-get-started");
const btnShowWelcome = document.getElementById("btn-show-welcome");
const welcomePickCloud = document.getElementById("welcome-pick-cloud");
const welcomePickOllama = document.getElementById("welcome-pick-ollama");

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

const btnToggleOllama = document.getElementById("btn-toggle-ollama");
const btnToggleCloud = document.getElementById("btn-toggle-cloud");
const btnThemeToggle = document.getElementById("btn-theme-toggle");
const btnWelcomeTheme = document.getElementById("btn-welcome-theme");

const approvalBanner = document.getElementById("approval-banner");
const approvalBannerText = document.getElementById("approval-banner-text");
const approvalDialog = document.getElementById("approval-dialog");
const approvalAgentName = document.getElementById("approval-agent-name");
const approvalToolName = document.getElementById("approval-tool-name");
const approvalToolArgs = document.getElementById("approval-tool-args");

const newAgentDialog = document.getElementById("new-agent-dialog");

// OwnStack Custom Branded Picker Modal (Replaces native Android/iOS/Desktop <select> dropdowns everywhere)
const pickerDialog = document.getElementById("picker-dialog");
const pickerDialogTitle = document.getElementById("picker-dialog-title");
const pickerDialogOptions = document.getElementById("picker-dialog-options");
const btnClosePicker = document.getElementById("btn-close-picker");

if (btnClosePicker && pickerDialog) {
  btnClosePicker.addEventListener("click", () => pickerDialog.close(""));
}

function openCustomPicker({ title = "Select Option", options = [], selectedValue = null, onSelect }) {
  if (!pickerDialog || !pickerDialogOptions) return;
  if (pickerDialogTitle) pickerDialogTitle.textContent = title;
  pickerDialogOptions.innerHTML = "";

  options.forEach((opt) => {
    const isSelected = String(opt.value) === String(selectedValue);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `w-full text-left rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 transition border ${
      isSelected
        ? "bg-emerald-500/10 border-emerald-500/50 text-primary font-semibold"
        : "bg-elevated pro-border text-primary hover:border-emerald-500/40"
    }`;
    btn.innerHTML = `
      <div class="min-w-0">
        <div class="text-xs truncate">${escapeHtml(opt.label)}</div>
        ${opt.subtitle ? `<div class="text-[10px] text-tertiary truncate mt-0.5">${escapeHtml(opt.subtitle)}</div>` : ""}
      </div>
      ${
        isSelected
          ? `<span class="text-emerald-600 text-xs font-bold shrink-0">✓</span>`
          : `<span class="text-tertiary text-xs shrink-0">›</span>`
      }
    `;
    btn.addEventListener("click", () => {
      pickerDialog.close("selected");
      if (onSelect) onSelect(opt.value);
    });
    pickerDialogOptions.appendChild(btn);
  });

  if (!pickerDialog.open) pickerDialog.showModal();
}

// Universal Native <dialog> Confirmation Helper (Safe Cancel button has autofocus, returnValue reset on close)
const confirmDialog = document.getElementById("confirm-dialog");
const confirmDialogTitle = document.getElementById("confirm-dialog-title");
const confirmDialogBadge = document.getElementById("confirm-dialog-badge");
const confirmDialogMessage = document.getElementById("confirm-dialog-message");
const confirmDialogOkBtn = document.getElementById("confirm-dialog-ok-btn");

function askConfirmation({
  title = "Confirm Action",
  message = "Are you sure you want to proceed?",
  confirmLabel = "Confirm",
  badge = "Confirmation",
  destructive = false,
}) {
  return new Promise((resolve) => {
    if (!confirmDialog) {
      resolve(window.confirm(message));
      return;
    }
    if (confirmDialogTitle) confirmDialogTitle.textContent = title;
    if (confirmDialogMessage) confirmDialogMessage.textContent = message;
    if (confirmDialogBadge) confirmDialogBadge.textContent = badge;
    if (confirmDialogOkBtn) {
      confirmDialogOkBtn.textContent = confirmLabel;
      confirmDialogOkBtn.className = destructive
        ? "bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-4 py-2 rounded-xl transition"
        : "btn-primary-pro text-xs px-4 py-2 rounded-xl";
    }

    const onClose = () => {
      const choice = confirmDialog.returnValue;
      confirmDialog.returnValue = "";
      confirmDialog.removeEventListener("close", onClose);
      resolve(choice === "confirm");
    };
    confirmDialog.addEventListener("close", onClose);
    if (!confirmDialog.open) {
      confirmDialog.showModal();
    }
  });
}

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
  if (modalPinInput) modalPinInput.value = state.accessPin;
}

function promptForAccessPin() {
  // Never pop open the PIN modal while the user is still viewing the Welcome Screen
  if (welcomeScreen && !welcomeScreen.classList.contains("hidden")) {
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

if (welcomePickCloud) {
  welcomePickCloud.addEventListener("click", () => {
    state.welcomeEngine = "cloud";
    welcomePickCloud.classList.add("ring-2", "ring-indigo-500/80");
    welcomePickOllama.classList.remove("ring-2", "ring-emerald-500/80");
  });
}

if (welcomePickOllama) {
  welcomePickOllama.addEventListener("click", () => {
    state.welcomeEngine = "ollama";
    welcomePickOllama.classList.add("ring-2", "ring-emerald-500/80");
    if (welcomePickCloud) welcomePickCloud.classList.remove("ring-2", "ring-indigo-500/80");
  });
}

btnGetStarted.addEventListener("click", async () => {
  localStorage.setItem("agy_onboarded", "true");
  welcomeScreen.classList.add("hidden");
  if (state.pinRequiredByServer && !state.accessPin) {
    promptForAccessPin();
  }
  await refreshHealth();
  await loadAgents();
  switchEngineProvider(state.welcomeEngine);
  connectWebSocket();
});

btnShowWelcome.addEventListener("click", () => {
  welcomeScreen.classList.remove("hidden");
});

// 3. Default by Device System Theme + Two-State Toggle (`dark-mode-toggle` compliant)
const SUN_PATH = "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z";
const MOON_PATH = "M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z";
const systemDarkMql = window.matchMedia("(prefers-color-scheme: dark)");

function getRenderedColorScheme() {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const content = meta ? meta.content : "light dark";
  if (content === "dark" || content === "light") return content;
  return systemDarkMql.matches ? "dark" : "light";
}

function syncThemeUI() {
  const rendered = getRenderedColorScheme();
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.content = rendered === "dark" ? "#0d0d0f" : "#ffffff";
  }
  const iconPath = rendered === "dark" ? SUN_PATH : MOON_PATH;
  document.querySelectorAll("#theme-toggle-svg path, #welcome-theme-svg path").forEach((p) => {
    p.setAttribute("d", iconPath);
  });
}

function applyStoredOrSystemScheme(storedValue) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.content = (storedValue === "light" || storedValue === "dark") ? storedValue : "light dark";
  }
  syncThemeUI();
}

// Initialize from localStorage (or follow device system default when unset)
try {
  applyStoredOrSystemScheme(localStorage.getItem("color-scheme"));
} catch (e) {
  applyStoredOrSystemScheme(null);
}

// Keep icon & theme-color synced if the user's device OS switches light/dark mode
systemDarkMql.addEventListener("change", () => {
  syncThemeUI();
});

function toggleTheme() {
  const currentRendered = getRenderedColorScheme();
  const target = currentRendered === "dark" ? "light" : "dark";
  const systemScheme = systemDarkMql.matches ? "dark" : "light";
  const meta = document.querySelector('meta[name="color-scheme"]');

  if (target === systemScheme) {
    // Target matches device system preference -> return to system default ("light dark")
    try {
      localStorage.removeItem("color-scheme");
    } catch (e) {}
    if (meta) meta.content = "light dark";
  } else {
    try {
      localStorage.setItem("color-scheme", target);
    } catch (e) {}
    if (meta) meta.content = target;
  }
  syncThemeUI();
}

btnThemeToggle.addEventListener("click", toggleTheme);
if (btnWelcomeTheme) btnWelcomeTheme.addEventListener("click", toggleTheme);

window.addEventListener("storage", (e) => {
  if (e.key === "color-scheme") {
    applyStoredOrSystemScheme(e.newValue);
  }
});

// 4. Segmented Local (Ollama) <-> Cloud AI Engine Switcher
function switchEngineProvider(targetProvider) {
  const matching = state.agents.filter((a) =>
    targetProvider === "cloud"
      ? a.provider === "cloud" || a.provider === "gemini"
      : a.provider === targetProvider
  );
  if (matching.length === 0) return;

  if (targetProvider === "ollama") {
    const pick = matching.find((a) => a.id === state.lastOllamaAgentId) || matching[0];
    state.activeAgentId = pick.id;
    state.lastOllamaAgentId = pick.id;
  } else if (targetProvider === "cloud") {
    const pick = matching.find((a) => a.id === state.lastCloudAgentId) || matching[0];
    state.activeAgentId = pick.id;
    state.lastCloudAgentId = pick.id;
  }

  renderAgentSelect();
  updateActiveAgentStrip();
  renderAgentsRoster();
}

if (btnToggleOllama) btnToggleOllama.addEventListener("click", () => switchEngineProvider("ollama"));
if (btnToggleCloud) btnToggleCloud.addEventListener("click", () => switchEngineProvider("cloud"));

const newAgentProviderSelect = document.getElementById("new-agent-provider");
const newAgentModelInput = document.getElementById("new-agent-model");
if (newAgentProviderSelect && newAgentModelInput) {
  newAgentProviderSelect.addEventListener("change", () => {
    if (newAgentProviderSelect.value === "cloud") {
      newAgentModelInput.value = "";
      newAgentModelInput.placeholder = "Blank for default Cloud AI model";
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
  state.activeTab = targetTab;
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
    if (state.pinRequiredByServer && !state.accessPin && welcomeScreen.classList.contains("hidden")) {
      promptForAccessPin();
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
      const wsName = parts[parts.length - 1] || "workspace";
      headerWorkspaceName.textContent = wsName;
      if (state.currentWorkspaceName !== wsName) {
        state.currentWorkspaceName = wsName;
        loadProjectChats(wsName);
      }
    }
    const pinToggle = document.getElementById("setting-pin-lock-toggle");
    if (pinToggle && typeof data.pin_lock_enabled === "boolean") {
      pinToggle.checked = data.pin_lock_enabled;
    }
    const cloudState = data.has_gemini_key ? "Cloud AI Ready" : "Cloud AI";
    if (ollamaStatusPill) {
      if (data.ollama && data.ollama.online) {
        ollamaStatusPill.textContent = `Local (${data.ollama.models.length}) • ${cloudState}`;
      } else {
        ollamaStatusPill.textContent = `${cloudState} • Local Standby`;
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
  const labelEl = document.getElementById("picker-agent-label");
  const active = state.agents.find((a) => a.id === state.activeAgentId);
  if (labelEl && active) {
    labelEl.textContent = active.name;
  }
}

const btnPickerAgent = document.getElementById("btn-picker-agent");
if (btnPickerAgent) {
  btnPickerAgent.addEventListener("click", () => {
    openCustomPicker({
      title: "Select Active Agent",
      selectedValue: state.activeAgentId,
      options: state.agents.map((a) => ({
        value: a.id,
        label: a.name,
        subtitle: `${a.provider.toUpperCase()} • ${a.role}`,
      })),
      onSelect: (chosenId) => {
        state.activeAgentId = chosenId;
        const picked = state.agents.find((a) => a.id === chosenId);
        if (picked) {
          if (picked.provider === "ollama") state.lastOllamaAgentId = picked.id;
          if (picked.provider === "cloud" || picked.provider === "gemini") state.lastCloudAgentId = picked.id;
        }
        renderAgentSelect();
        updateActiveAgentStrip();
        renderAgentsRoster();
      },
    });
  });
}

function updateActiveAgentStrip() {
  const agent = state.agents.find((a) => a.id === state.activeAgentId);
  if (!agent) return;

  if (btnToggleOllama) btnToggleOllama.classList.remove("is-active");
  if (btnToggleCloud) btnToggleCloud.classList.remove("is-active");
  if (agent.provider === "ollama") {
    if (btnToggleOllama) btnToggleOllama.classList.add("is-active");
    if (chatAgentProviderBadge) chatAgentProviderBadge.textContent = "LOCAL AI";
  } else if (agent.provider === "cloud" || agent.provider === "gemini") {
    if (btnToggleCloud) btnToggleCloud.classList.add("is-active");
    if (chatAgentProviderBadge) chatAgentProviderBadge.textContent = "CLOUD AI";
  } else {
    if (chatAgentProviderBadge) chatAgentProviderBadge.textContent = "ON-DEVICE";
  }

  if (chatAgentRole) chatAgentRole.textContent = agent.role;
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
const INLINE_SPINNER_SVG = `<svg class="w-3.5 h-3.5 animate-spin inline-block mr-1.5 -mt-0.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path></svg>`;

/**
 * Wraps an async button click action with a visible loading spinner + brief "Done ✓" feedback
 */
async function withButtonLoader(btn, loadingText, actionFn) {
  if (!btn || btn.disabled) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add("opacity-75");
  btn.innerHTML = `${INLINE_SPINNER_SVG}<span>${loadingText}</span>`;
  try {
    await Promise.all([
      actionFn(),
      new Promise((resolve) => setTimeout(resolve, 350)), // Ensure spinner is visibly perceived
    ]);
    btn.innerHTML = `<span>✓ Updated</span>`;
    await new Promise((resolve) => setTimeout(resolve, 650));
  } finally {
    btn.disabled = false;
    btn.classList.remove("opacity-75");
    btn.innerHTML = originalHtml;
  }
}

function updateSendButtonState() {
  if (!btnSendChat) return;
  const hasText = chatInput && chatInput.value.trim().length > 0;
  if (state.isGenerating) {
    btnSendChat.disabled = true;
    btnSendChat.innerHTML = RUNNING_SPINNER_SVG;
    btnSendChat.classList.add("opacity-60", "cursor-not-allowed");
    btnSendChat.classList.remove("opacity-35");
  } else if (!hasText) {
    btnSendChat.disabled = true;
    btnSendChat.innerHTML = SEND_ARROW_SVG;
    btnSendChat.classList.add("opacity-35", "cursor-not-allowed");
    btnSendChat.classList.remove("opacity-60");
  } else {
    btnSendChat.disabled = false;
    btnSendChat.innerHTML = SEND_ARROW_SVG;
    btnSendChat.classList.remove("opacity-35", "opacity-60", "cursor-not-allowed");
  }
}

function setGeneratingState(running) {
  state.isGenerating = Boolean(running);
  updateSendButtonState();
  document.querySelectorAll(".quick-prompt-btn").forEach((b) => {
    b.disabled = state.isGenerating;
  });
}

if (chatInput) {
  chatInput.addEventListener("input", updateSendButtonState);
}
updateSendButtonState();

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function highlightCodeLine(line) {
  // Single-pass tokenizer so generated <span class="..."> HTML is NEVER corrupted by later regexes!
  const escaped = escapeHtml(line);
  if (/^\s*(#|\/\/|\/\*|\*)/.test(escaped)) {
    return `<span class="tok-com">${escaped}</span>`;
  }
  const tokenRegex =
    /(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|"[^"]*"|'[^']*'|&lt;\/?[a-zA-Z0-9_-]+|\/?&gt;|\b(?:def|class|async|await|return|import|from|if|elif|else|for|while|try|except|finally|with|as|const|let|var|function|export|default|true|false|null|None|True|False|in|not|and|or)\b|\b\d+(?:\.\d+)?\b)/g;

  return escaped.replace(tokenRegex, (match) => {
    if (
      match.startsWith("&quot;") ||
      match.startsWith("&#39;") ||
      match.startsWith('"') ||
      match.startsWith("'")
    ) {
      return `<span class="tok-str">${match}</span>`;
    }
    if (match.startsWith("&lt;") || match.endsWith("&gt;")) {
      return `<span class="tok-tag">${match}</span>`;
    }
    if (/^\d/.test(match)) {
      return `<span class="tok-num">${match}</span>`;
    }
    return `<span class="tok-kw">${match}</span>`;
  });
}

function formatSimpleMarkdown(text) {
  // Handle fenced code blocks ```lang ... ``` first with syntax coloring!
  const segments = text.split(/(```[\s\S]*?```)/g);
  return segments
    .map((seg) => {
      if (seg.startsWith("```") && seg.endsWith("```")) {
        const inner = seg.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, "");
        const highlighted = inner
          .split("\n")
          .map((l) => {
            if (l.startsWith("+") && !l.startsWith("+++")) {
              return `<div class="diff-add px-2 rounded">${escapeHtml(l)}</div>`;
            }
            if (l.startsWith("-") && !l.startsWith("---")) {
              return `<div class="diff-del px-2 rounded">${escapeHtml(l)}</div>`;
            }
            if (l.startsWith("@@")) {
              return `<div class="diff-hunk px-2 rounded">${escapeHtml(l)}</div>`;
            }
            return `<div>${highlightCodeLine(l)}</div>`;
          })
          .join("");
        return `<pre class="code-surface border pro-border rounded-xl p-3 my-2 font-mono text-xs overflow-x-auto leading-relaxed">${highlighted}</pre>`;
      }
      let safe = escapeHtml(seg);
      safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong class='font-semibold text-primary'>$1</strong>");
      safe = safe.replace(
        /`([^`]+)`/g,
        "<code class='pro-pill px-1.5 py-0.5 rounded-md text-[11px] font-mono'>$1</code>"
      );
      safe = safe.replace(/\n/g, "<br/>");
      return safe;
    })
    .join("");
}

function handleStreamEvent(msg) {
  if (msg.type === "turn_start") {
    setGeneratingState(true);
    if (chatEmptyState) chatEmptyState.classList.add("hidden");
    const card = document.createElement("div");
    card.className = "space-y-2 py-2";
    card.innerHTML = `
      <div class="flex items-center gap-2.5 text-xs">
        <img src="/static/ownstack-logo.jpeg" alt="OwnStack" class="w-6 h-6 rounded-lg object-cover border pro-border shadow-sm shrink-0" />
        <span class="turn-running-pill thinking-label text-xs tracking-tight animate-pulse">Thinking...</span>
      </div>
      <div class="pl-8 space-y-2">
        <div class="tool-status-line hidden text-[11px] font-mono text-tertiary"></div>
        <div class="response-content text-sm text-primary leading-relaxed"></div>
      </div>
    `;
    chatThread.appendChild(card);
    state.activeTurnCard = {
      el: card,
      rawText: "",
      runningPill: card.querySelector(".turn-running-pill"),
      toolStatusLine: card.querySelector(".tool-status-line"),
      responseContent: card.querySelector(".response-content"),
    };
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (msg.type === "thought_delta" && state.activeTurnCard) {
    // Keep UI minimal during thinking: just logo + Thinking... label
  } else if (msg.type === "tool_start" && state.activeTurnCard) {
    if (state.activeTurnCard.toolStatusLine) {
      const cmd =
        msg.arguments && (msg.arguments.CommandLine || msg.arguments.Path)
          ? `: ${msg.arguments.CommandLine || msg.arguments.Path}`
          : "";
      state.activeTurnCard.toolStatusLine.classList.remove("hidden");
      state.activeTurnCard.toolStatusLine.textContent = `⚡ ${msg.tool_name}${cmd}`;
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (msg.type === "tool_end" && state.activeTurnCard) {
    if (state.activeTurnCard.toolStatusLine) {
      state.activeTurnCard.toolStatusLine.classList.add("hidden");
    }
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
    if (state.activeTurnCard.runningPill) {
      state.activeTurnCard.runningPill.classList.remove("animate-pulse");
      state.activeTurnCard.runningPill.textContent = "";
    }
    state.activeTurnCard.rawText += msg.delta;
    state.activeTurnCard.responseContent.innerHTML = formatSimpleMarkdown(state.activeTurnCard.rawText);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (msg.type === "turn_end") {
    if (state.activeTurnCard && state.activeTurnCard.runningPill) {
      state.activeTurnCard.runningPill.remove();
    }
    if (state.activeTurnCard && state.activeTurnCard.toolStatusLine) {
      state.activeTurnCard.toolStatusLine.classList.add("hidden");
    }
    if (msg.content) {
      appendMessageToActiveChat("assistant", msg.content);
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

// 8. Send Chat Prompt + Automatic Code Checkpoint + Enter Key Handler
async function createPromptCheckpoint(label) {
  try {
    const res = await fetch("/api/checkpoints/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.slice(0, 60) }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.created && data.tree_sha) return data.tree_sha;
    }
  } catch (e) {}
  return null;
}

async function restoreCodeToCheckpoint(treeSha, msgIndex = null) {
  if (!treeSha) return;
  try {
    const res = await fetch("/api/checkpoints/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tree_sha: treeSha }),
    });
    if (res.ok) {
      if (msgIndex !== null) {
        const ws = state.currentWorkspaceName || "workspace";
        const store = getAllProjectChatsStore();
        const chat = (store[ws] || []).find((c) => c.id === state.activeChatId);
        if (chat) {
          chat.messages = chat.messages.slice(0, msgIndex);
          chat.updatedAt = Date.now();
          saveAllProjectChatsStore(store);
          renderActiveChatThread(ws);
        }
      }
      await loadFileTree();
      await loadGitStatus();
      return true;
    }
  } catch (e) {}
  return false;
}

function buildUserMessageRow(text, msgIndex, checkpointSha) {
  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-col items-end gap-1 group";

  const bubble = document.createElement("div");
  bubble.className = "pro-pill rounded-2xl rounded-br-sm px-4 py-2.5 text-sm text-primary max-w-[85%]";
  bubble.textContent = text;
  wrapper.appendChild(bubble);

  const actions = document.createElement("div");
  actions.className = "flex items-center gap-2 text-[10px] text-tertiary px-1";

  // Edit Previous Prompt Button (With Confirmation Card!)
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "hover:text-primary font-medium transition";
  editBtn.textContent = "✏️ Edit";
  editBtn.addEventListener("click", async () => {
    if (state.isGenerating) return;
    const confirmed = await askConfirmation({
      title: "Edit Previous Prompt?",
      message: checkpointSha
        ? `This will rewind the chat and restore your workspace files back to checkpoint ${checkpointSha.slice(0, 7)} so you can edit and resend this prompt.`
        : "This will rewind the conversation back to this prompt so you can edit and resend it.",
      confirmLabel: "Rewind & Edit",
      badge: "Edit Prompt",
      destructive: true,
    });
    if (!confirmed) return;

    if (checkpointSha) {
      await restoreCodeToCheckpoint(checkpointSha, msgIndex);
    } else {
      const ws = state.currentWorkspaceName || "workspace";
      const store = getAllProjectChatsStore();
      const chat = (store[ws] || []).find((c) => c.id === state.activeChatId);
      if (chat) {
        chat.messages = chat.messages.slice(0, msgIndex);
        saveAllProjectChatsStore(store);
        renderActiveChatThread(ws);
      }
    }
    chatInput.value = text;
    updateSendButtonState();
    chatInput.focus();
  });
  actions.appendChild(editBtn);

  // Restore Code Checkpoint Button (With Confirmation Card!)
  if (checkpointSha) {
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "hover:text-emerald-600 font-medium transition";
    restoreBtn.title = `Restore workspace files to snapshot ${checkpointSha.slice(0, 7)}`;
    restoreBtn.textContent = `↺ Restore Code (${checkpointSha.slice(0, 6)})`;
    restoreBtn.addEventListener("click", async () => {
      if (state.isGenerating) return;
      const confirmed = await askConfirmation({
        title: "Restore Code Checkpoint?",
        message: `All workspace files will be reverted back to snapshot ${checkpointSha.slice(0, 7)} (captured right before "${text.slice(0, 40)}"). Any edits made after this point will be undone.`,
        confirmLabel: "Restore Code",
        badge: "Checkpoint",
        destructive: true,
      });
      if (!confirmed) return;
      restoreBtn.textContent = "Restoring...";
      const ok = await restoreCodeToCheckpoint(checkpointSha, msgIndex);
      if (ok) {
        restoreBtn.textContent = "✓ Code Restored";
      }
    });
    actions.appendChild(restoreBtn);
  }

  wrapper.appendChild(actions);
  return wrapper;
}

async function sendChatPrompt(promptText) {
  const text = promptText.trim();
  if (!text || state.isGenerating) return;

  if (state.pinRequiredByServer && !state.accessPin) {
    promptForAccessPin();
    return;
  }

  setGeneratingState(true);
  if (chatEmptyState) chatEmptyState.classList.add("hidden");

  // Snapshot workspace code BEFORE the agent runs so user can restore to this exact checkpoint!
  const checkpointSha = await createPromptCheckpoint(text);
  const msgIndex = appendMessageToActiveChat("user", text, checkpointSha);

  const row = buildUserMessageRow(text, msgIndex, checkpointSha);
  chatThread.appendChild(row);
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
  updateSendButtonState();
});

// Send on Enter (without Shift), allow new line with Shift+Enter
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChatPrompt(chatInput.value);
    chatInput.value = "";
    chatInput.style.height = "auto";
    updateSendButtonState();
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
        <div class="repo-obscurable text-xs font-semibold text-primary truncate font-mono">${escapeHtml(ws.name)}</div>
        <div class="repo-obscurable text-[10px] text-tertiary truncate">${escapeHtml(ws.path)}</div>
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

state.loadedGitHubRepos = [];
state.loadedActiveWorkspace = "";

function renderFilteredGitHubRepos(query = "") {
  const grid = document.getElementById("github-repos-grid");
  const countBadge = document.getElementById("github-repo-count");
  if (!grid) return;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? state.loadedGitHubRepos.filter(
        (r) =>
          (r.name || "").toLowerCase().includes(q) ||
          (r.description || "").toLowerCase().includes(q) ||
          (r.language || "").toLowerCase().includes(q)
      )
    : state.loadedGitHubRepos;

  if (countBadge) {
    countBadge.textContent = `(${filtered.length}${q ? ` of ${state.loadedGitHubRepos.length}` : ""})`;
  }

  grid.innerHTML = "";
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="text-xs text-tertiary col-span-2">No matching repositories found.</div>`;
    return;
  }

  filtered.forEach((repo) => {
    const isCurrent = state.loadedActiveWorkspace === repo.name;
    const card = document.createElement("div");
    card.className = "pro-card rounded-2xl p-4 flex flex-col justify-between gap-3 hover:border-emerald-500 transition";
    const visBadge = repo.private
      ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Private</span>`
      : `<span class="text-[10px] px-2 py-0.5 rounded-full pro-pill text-tertiary">Public</span>`;
    card.innerHTML = `
      <div class="space-y-1">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="repo-obscurable text-xs font-semibold text-primary font-mono truncate">${escapeHtml(repo.name)}</span>
            ${visBadge}
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full pro-pill text-secondary shrink-0">${escapeHtml(repo.language)}</span>
        </div>
        <p class="repo-obscurable text-[11px] text-secondary line-clamp-2">${escapeHtml(repo.description)}</p>
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
          body: JSON.stringify({
            repo_url: repo.clone_url,
            folder_name: repo.name,
            token: state.githubToken || null,
          }),
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

async function loadGitHubRepos() {
  const grid = document.getElementById("github-repos-grid");
  if (!grid) return;
  const userEl = document.getElementById("github-username-input");
  const tokenEl = document.getElementById("github-token-input");
  const authBadge = document.getElementById("github-auth-badge");
  const searchEl = document.getElementById("github-repo-search");
  const username = (userEl ? userEl.value.trim() : "RealRiga") || "RealRiga";
  const token = (tokenEl ? tokenEl.value.trim() : "") || state.githubToken;
  if (token) {
    state.githubToken = token;
    try {
      localStorage.setItem("agy_github_token", token);
    } catch (e) {}
  }

  grid.innerHTML = `<div class="text-xs text-tertiary col-span-2">Loading all GitHub repositories for @${escapeHtml(username)}...</div>`;
  // Pass GitHub token strictly via X-GitHub-Token header (never in URL query string!)
  const url = `/api/github/repos?username=${encodeURIComponent(username)}`;
  const reqHeaders = {};
  if (token) {
    reqHeaders["X-GitHub-Token"] = token;
  }
  const res = await fetch(url, { headers: reqHeaders });
  if (!res.ok) return;
  const data = await res.json();

  if (authBadge) {
    if (data.authenticated) {
      authBadge.textContent = `🔒 Public & Private (${(data.repos || []).length})`;
      authBadge.className = "text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600";
    } else {
      authBadge.textContent = `Public Only (${(data.repos || []).length}) — Add Token for Private`;
      authBadge.className = "text-[10px] font-medium px-2 py-0.5 rounded-full pro-pill text-secondary";
    }
  }

  state.loadedGitHubRepos = data.repos || [];
  state.loadedActiveWorkspace = data.active_workspace || "";
  renderFilteredGitHubRepos(searchEl ? searchEl.value : "");
}

const ghSearchInput = document.getElementById("github-repo-search");
if (ghSearchInput) {
  ghSearchInput.addEventListener("input", () => renderFilteredGitHubRepos(ghSearchInput.value));
}

const btnFetchGithub = document.getElementById("btn-fetch-github-repos");
if (btnFetchGithub) {
  btnFetchGithub.addEventListener("click", () =>
    withButtonLoader(btnFetchGithub, "Loading...", loadGitHubRepos)
  );
}
const btnSaveGhToken = document.getElementById("btn-save-github-token");
if (btnSaveGhToken) {
  btnSaveGhToken.addEventListener("click", () =>
    withButtonLoader(btnSaveGhToken, "Connecting...", loadGitHubRepos)
  );
}

// 10. File Explorer, Editor & Diff Viewer (GitHub-Style Folder Tree + Breadcrumb Navigation)
state.allWorkspaceFiles = [];
state.currentExplorerDir = "";

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function loadFileTree(targetDir = state.currentExplorerDir) {
  const res = await fetch("/api/files");
  if (!res.ok) return;
  const data = await res.json();
  state.allWorkspaceFiles = data.files || [];
  renderExplorerDirectory(targetDir);
}

function renderExplorerDirectory(dirPath = "") {
  state.currentExplorerDir = dirPath;
  const pane = document.getElementById("file-tree-pane");
  if (!pane) return;
  pane.innerHTML = "";

  // 1. Breadcrumb Header (Like GitHub Repo Tree: root / folder / subfolder)
  const crumbBar = document.createElement("div");
  crumbBar.className = "flex items-center flex-wrap gap-1 px-2 py-1.5 mb-1.5 text-xs font-mono border-b pro-border";
  const rootBtn = document.createElement("button");
  rootBtn.type = "button";
  rootBtn.className = "repo-obscurable font-semibold text-indigo-600 hover:underline";
  rootBtn.textContent = headerWorkspaceName ? headerWorkspaceName.textContent : "root";
  rootBtn.addEventListener("click", () => renderExplorerDirectory(""));
  crumbBar.appendChild(rootBtn);

  if (dirPath) {
    const parts = dirPath.split("/");
    let acc = "";
    parts.forEach((part) => {
      acc = acc ? `${acc}/${part}` : part;
      const sep = document.createElement("span");
      sep.className = "text-tertiary";
      sep.textContent = "/";
      crumbBar.appendChild(sep);

      const segBtn = document.createElement("button");
      segBtn.type = "button";
      segBtn.className = "font-medium text-primary hover:underline";
      segBtn.textContent = part;
      const target = acc;
      segBtn.addEventListener("click", () => renderExplorerDirectory(target));
      crumbBar.appendChild(segBtn);
    });
  }
  pane.appendChild(crumbBar);

  // 2. Parent ".." row if inside a subdirectory
  if (dirPath) {
    const upParts = dirPath.split("/");
    upParts.pop();
    const parentDir = upParts.join("/");
    const upRow = document.createElement("button");
    upRow.type = "button";
    upRow.className = "w-full text-left pro-card rounded-xl px-3 py-2 hover:border-indigo-500 flex items-center gap-2 text-xs font-mono text-secondary transition";
    upRow.innerHTML = `<span>↩</span><span>..</span>`;
    upRow.addEventListener("click", () => renderExplorerDirectory(parentDir));
    pane.appendChild(upRow);
  }

  // 3. Compute immediate child folders and immediate files inside `dirPath` (Just like GitHub!)
  const childDirs = new Map();
  const childFiles = [];
  const prefix = dirPath ? `${dirPath}/` : "";

  state.allWorkspaceFiles.forEach((f) => {
    if (dirPath && !f.path.startsWith(prefix)) return;
    const rel = dirPath ? f.path.slice(prefix.length) : f.path;
    if (!rel) return;
    const slashIdx = rel.indexOf("/");
    if (slashIdx !== -1) {
      const folderName = rel.slice(0, slashIdx);
      const fullFolder = dirPath ? `${dirPath}/${folderName}` : folderName;
      childDirs.set(folderName, {
        name: folderName,
        path: fullFolder,
        count: (childDirs.get(folderName)?.count || 0) + 1,
      });
    } else {
      childFiles.push(f);
    }
  });

  // Render folders first with folder icon
  Array.from(childDirs.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((folder) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "w-full text-left pro-card rounded-xl px-3 py-2.5 hover:border-indigo-500 flex items-center justify-between gap-2 transition";
      row.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <svg class="w-4 h-4 text-indigo-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <span class="text-xs font-mono font-semibold text-primary truncate">${escapeHtml(folder.name)}/</span>
        </div>
        <span class="text-[10px] text-tertiary shrink-0">${folder.count} items ›</span>
      `;
      row.addEventListener("click", () => renderExplorerDirectory(folder.path));
      pane.appendChild(row);
    });

  // Render files second with file icon
  childFiles
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((f) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "w-full text-left pro-card rounded-xl px-3 py-2.5 hover:border-indigo-500 flex items-center justify-between gap-2 transition";
      row.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <svg class="w-4 h-4 text-tertiary shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span class="text-xs font-mono font-medium text-primary truncate">${escapeHtml(f.name)}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${
            f.modified
              ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">M</span>`
              : ""
          }
          <span class="text-[10px] text-tertiary">${formatBytes(f.size)}</span>
        </div>
      `;
      row.addEventListener("click", () => openFileInEditor(f.path));
      pane.appendChild(row);
    });
}

function detectLanguageLabel(filepath) {
  const ext = (filepath.split(".").pop() || "").toLowerCase();
  const map = {
    py: "Python",
    js: "JavaScript",
    ts: "TypeScript",
    html: "HTML",
    css: "CSS",
    json: "JSON",
    md: "Markdown",
    yml: "YAML",
    yaml: "YAML",
    sh: "Shell Script",
    dart: "Dart / Flutter",
  };
  return map[ext] || "Code / Text";
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"]);

function isImagePath(filepath) {
  const ext = (filepath.split(".").pop() || "").toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function renderSyntaxHighlightedFile(content) {
  const viewer = document.getElementById("file-syntax-viewer");
  if (!viewer) return;
  const lines = (content || "").split("\n");
  // Render inside a single min-w-max block so all lines scroll horizontally together like VS Code!
  const rows = lines
    .map(
      (line, idx) =>
        `<div class="flex items-start gap-3 px-1 hover:bg-zinc-500/5"><span class="w-9 shrink-0 text-right text-[10px] text-tertiary select-none pr-2 border-r pro-border">${
          idx + 1
        }</span><span class="whitespace-pre">${highlightCodeLine(line) || " "}</span></div>`
    )
    .join("");
  viewer.innerHTML = `<div class="min-w-max">${rows}</div>`;
}

async function openFileInEditor(path) {
  state.currentFilePath = path;
  state.showingDiff = false;
  state.editingFile = false;

  document.getElementById("current-file-label").textContent = path;
  if (window.innerWidth < 1024) {
    document.getElementById("file-tree-pane").classList.add("hidden");
  }
  const editorPane = document.getElementById("file-editor-pane");
  editorPane.classList.remove("hidden");
  editorPane.classList.add("flex");
  document.getElementById("btn-back-to-tree").classList.remove("hidden");

  const wrapper = document.getElementById("code-editor-wrapper");
  const imgViewer = document.getElementById("file-image-viewer");
  const imgPreview = document.getElementById("file-image-preview");
  const imgMeta = document.getElementById("file-image-meta");
  const syntaxViewer = document.getElementById("file-syntax-viewer");
  const textarea = document.getElementById("file-editor-textarea");
  const diffViewer = document.getElementById("file-diff-viewer");
  const btnEditMode = document.getElementById("btn-toggle-edit-mode");
  const btnDiff = document.getElementById("btn-toggle-file-diff");
  const btnSave = document.getElementById("btn-save-file");
  const langBadge = document.getElementById("editor-lang-badge");
  const lineCount = document.getElementById("editor-line-count");

  if (wrapper) wrapper.classList.remove("hidden");
  diffViewer.classList.add("hidden");

  // 1. Handle Image Files (Render actual image via /api/files/raw instead of binary gibberish!)
  if (isImagePath(path)) {
    if (syntaxViewer) syntaxViewer.classList.add("hidden");
    textarea.classList.add("hidden");
    if (btnEditMode) btnEditMode.classList.add("hidden");
    if (btnDiff) btnDiff.classList.add("hidden");
    if (btnSave) btnSave.classList.add("hidden");
    if (langBadge) langBadge.textContent = "Image Preview";
    if (lineCount) lineCount.textContent = (path.split(".").pop() || "").toUpperCase();

    if (imgViewer && imgPreview) {
      imgViewer.classList.remove("hidden");
      const pinParam = state.accessPin ? `&pin=${encodeURIComponent(state.accessPin)}` : "";
      imgPreview.src = `/api/files/raw?path=${encodeURIComponent(path)}${pinParam}`;
      if (imgMeta) imgMeta.textContent = path;
    }
    return;
  }

  // 2. Handle Text / Code Files
  if (imgViewer) imgViewer.classList.add("hidden");
  const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) return;
  const data = await res.json();
  state.currentFileDiff = data.diff || "";

  if (langBadge) langBadge.textContent = detectLanguageLabel(data.path);
  if (lineCount) lineCount.textContent = `${data.lines || 0} lines`;

  if (btnSave) btnSave.classList.add("hidden");
  if (btnEditMode) {
    btnEditMode.classList.remove("hidden");
    btnEditMode.textContent = "Edit";
  }
  if (btnDiff) {
    btnDiff.classList.remove("hidden");
    btnDiff.textContent = "Diff";
  }

  if (syntaxViewer) syntaxViewer.classList.remove("hidden");
  textarea.classList.add("hidden");
  textarea.value = data.content;
  renderSyntaxHighlightedFile(data.content);
}

const btnToggleEditMode = document.getElementById("btn-toggle-edit-mode");
if (btnToggleEditMode) {
  btnToggleEditMode.addEventListener("click", () => {
    state.editingFile = !state.editingFile;
    const syntaxViewer = document.getElementById("file-syntax-viewer");
    const textarea = document.getElementById("file-editor-textarea");
    const diffViewer = document.getElementById("file-diff-viewer");
    const saveBtn = document.getElementById("btn-save-file");
    const wrapper = document.getElementById("code-editor-wrapper");
    if (wrapper) wrapper.classList.remove("hidden");
    diffViewer.classList.add("hidden");
    state.showingDiff = false;
    document.getElementById("btn-toggle-file-diff").textContent = "View Diff";

    if (state.editingFile) {
      if (syntaxViewer) syntaxViewer.classList.add("hidden");
      textarea.classList.remove("hidden");
      saveBtn.classList.remove("hidden");
      btnToggleEditMode.textContent = "Syntax View";
      textarea.focus();
    } else {
      renderSyntaxHighlightedFile(textarea.value);
      if (syntaxViewer) syntaxViewer.classList.remove("hidden");
      textarea.classList.add("hidden");
      saveBtn.classList.add("hidden");
      btnToggleEditMode.textContent = "Edit File";
    }
  });
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
  const confirmed = await askConfirmation({
    title: "Save File Changes?",
    message: `Write your edits to ${state.currentFilePath}?`,
    confirmLabel: "Save File",
    badge: "File Edit",
  });
  if (!confirmed) return;

  const content = document.getElementById("file-editor-textarea").value;
  const res = await fetch("/api/files/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: state.currentFilePath, content }),
  });
  const data = await res.json();
  state.currentFileDiff = data.diff || "";
  renderSyntaxHighlightedFile(content);
  const btn = document.getElementById("btn-save-file");
  btn.textContent = "Saved ✓";
  setTimeout(() => (btn.textContent = "Save"), 1400);
});

document.getElementById("btn-toggle-file-diff").addEventListener("click", () => {
  const wrapper = document.getElementById("code-editor-wrapper");
  const textarea = document.getElementById("file-editor-textarea");
  const diffViewer = document.getElementById("file-diff-viewer");
  const btn = document.getElementById("btn-toggle-file-diff");
  state.showingDiff = !state.showingDiff;

  if (state.showingDiff) {
    if (wrapper) wrapper.classList.add("hidden");
    textarea.classList.add("hidden");
    diffViewer.classList.remove("hidden");
    btn.textContent = "Edit Code";
    renderDiffLines(diffViewer, state.currentFileDiff || "No changes compared to HEAD / initial snapshot.");
  } else {
    if (wrapper) wrapper.classList.remove("hidden");
    textarea.classList.remove("hidden");
    diffViewer.classList.add("hidden");
    btn.textContent = "View Diff";
  }
});

const btnRefreshFiles = document.getElementById("btn-refresh-files");
btnRefreshFiles.addEventListener("click", () =>
  withButtonLoader(btnRefreshFiles, "Refreshing...", () => loadFileTree())
);

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

// 11. VS Code-Style Git Source Control (Staged/Unstaged, Per-File Diff Compare, Stage +, Unstage -, Discard ↺)
let lastFullGitDiff = "";

async function inspectSingleFileGitDiff(filepath) {
  const diffBox = document.getElementById("git-diff-box");
  const diffTitle = document.getElementById("git-diff-title");
  const btnAll = document.getElementById("btn-git-show-all-diff");
  if (diffTitle) diffTitle.textContent = `Diff: ${filepath}`;
  if (btnAll) btnAll.classList.remove("hidden");
  if (diffBox) diffBox.textContent = "Loading diff...";
  const res = await fetch(`/api/git/file-diff?path=${encodeURIComponent(filepath)}`);
  if (res.ok) {
    const data = await res.json();
    renderDiffLines(
      diffBox,
      data.diff && data.diff.trim() ? data.diff : `No diff lines (file "${filepath}" may be newly untracked or identical to HEAD).`
    );
  }
}

function buildGitFileRow(f, isStagedRow) {
  const row = document.createElement("div");
  row.className = "flex items-center justify-between gap-2 bg-elevated border pro-border px-3 py-2 rounded-xl";

  const leftBtn = document.createElement("button");
  leftBtn.type = "button";
  leftBtn.className = "flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-80";
  leftBtn.title = "Click to compare file diff";
  leftBtn.innerHTML = `
    <span class="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
      isStagedRow ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"
    } shrink-0">${escapeHtml(f.status)}</span>
    <span class="font-mono text-primary font-medium truncate text-xs">${escapeHtml(f.path)}</span>
  `;
  leftBtn.addEventListener("click", () => inspectSingleFileGitDiff(f.path));

  const actions = document.createElement("div");
  actions.className = "flex items-center gap-1 shrink-0";

  // Compare Diff button
  const diffBtn = document.createElement("button");
  diffBtn.type = "button";
  diffBtn.className = "pro-pill text-[10px] font-semibold px-2 py-1 rounded-lg hover:border-indigo-500";
  diffBtn.textContent = "Diff";
  diffBtn.addEventListener("click", () => inspectSingleFileGitDiff(f.path));
  actions.appendChild(diffBtn);

  if (isStagedRow) {
    // Unstage (-)
    const unstageBtn = document.createElement("button");
    unstageBtn.type = "button";
    unstageBtn.className = "pro-pill text-xs font-bold px-2 py-0.5 rounded-lg";
    unstageBtn.title = "Unstage file";
    unstageBtn.textContent = "−";
    unstageBtn.addEventListener("click", async () => {
      await fetch("/api/git/unstage-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: f.path }),
      });
      await loadGitStatus();
    });
    actions.appendChild(unstageBtn);
  } else {
    // Stage (+)
    const stageBtn = document.createElement("button");
    stageBtn.type = "button";
    stageBtn.className = "pro-pill text-xs font-bold text-emerald-600 px-2 py-0.5 rounded-lg";
    stageBtn.title = "Stage file";
    stageBtn.textContent = "+";
    stageBtn.addEventListener("click", async () => {
      await fetch("/api/git/stage-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: f.path }),
      });
      await loadGitStatus();
    });
    actions.appendChild(stageBtn);

    // Discard / Revert (↺) with confirmation card!
    const revertBtn = document.createElement("button");
    revertBtn.type = "button";
    revertBtn.className = "pro-pill text-xs font-bold text-rose-500 px-2 py-0.5 rounded-lg";
    revertBtn.title = "Discard / Revert changes";
    revertBtn.textContent = "↺";
    revertBtn.addEventListener("click", async () => {
      const ok = await askConfirmation({
        title: "Discard File Changes?",
        message: `Revert "${f.path}" back to the last commit? Unsaved changes in this file will be permanently lost.`,
        confirmLabel: "Discard Changes",
        badge: "Revert",
        destructive: true,
      });
      if (!ok) return;
      await fetch("/api/git/discard-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: f.path }),
      });
      await loadGitStatus();
      await loadFileTree();
    });
    actions.appendChild(revertBtn);
  }

  row.appendChild(leftBtn);
  row.appendChild(actions);
  return row;
}

async function loadGitStatus() {
  const res = await fetch("/api/git/status");
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById("git-current-branch").textContent = data.branch || "main";

  const stagedSection = document.getElementById("git-staged-section");
  const stagedContainer = document.getElementById("git-staged-files");
  const filesContainer = document.getElementById("git-changed-files");
  if (stagedContainer) stagedContainer.innerHTML = "";
  filesContainer.innerHTML = "";

  const allFiles = data.files || [];
  const stagedList = allFiles.filter((f) => f.staged);
  const unstagedList = allFiles.filter((f) => f.unstaged || !f.staged);

  if (stagedSection && stagedContainer) {
    if (stagedList.length > 0) {
      stagedSection.classList.remove("hidden");
      stagedList.forEach((f) => stagedContainer.appendChild(buildGitFileRow(f, true)));
    } else {
      stagedSection.classList.add("hidden");
    }
  }

  if (unstagedList.length === 0) {
    filesContainer.innerHTML = `<div class="text-tertiary text-xs">Working tree clean.</div>`;
  } else {
    unstagedList.forEach((f) => filesContainer.appendChild(buildGitFileRow(f, false)));
  }

  lastFullGitDiff = data.diff && data.diff.trim() ? data.diff : "No uncommitted changes.";
  const diffBox = document.getElementById("git-diff-box");
  const diffTitle = document.getElementById("git-diff-title");
  const btnAll = document.getElementById("btn-git-show-all-diff");
  if (diffTitle) diffTitle.textContent = "Unified Diff (Working Tree)";
  if (btnAll) btnAll.classList.add("hidden");
  renderDiffLines(diffBox, lastFullGitDiff);

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

const btnShowAllDiff = document.getElementById("btn-git-show-all-diff");
if (btnShowAllDiff) {
  btnShowAllDiff.addEventListener("click", () => {
    const diffBox = document.getElementById("git-diff-box");
    const diffTitle = document.getElementById("git-diff-title");
    if (diffTitle) diffTitle.textContent = "Unified Diff (Working Tree)";
    btnShowAllDiff.classList.add("hidden");
    renderDiffLines(diffBox, lastFullGitDiff);
  });
}

const btnRefreshGit = document.getElementById("btn-refresh-git");
btnRefreshGit.addEventListener("click", () =>
  withButtonLoader(btnRefreshGit, "Refreshing...", loadGitStatus)
);

const btnStageAll = document.getElementById("btn-git-stage-all");
btnStageAll.addEventListener("click", () =>
  withButtonLoader(btnStageAll, "Staging...", async () => {
    await fetch("/api/git/stage", { method: "POST" });
    await loadGitStatus();
  })
);

document.getElementById("btn-git-commit").addEventListener("click", async () => {
  const input = document.getElementById("git-commit-msg");
  const msg = input.value.trim();
  if (!msg) return;
  const confirmed = await askConfirmation({
    title: "Commit All Changes?",
    message: `Stage all modified files and create a Git commit with message: "${msg}"?`,
    confirmLabel: "Commit Now",
    badge: "Git Commit",
  });
  if (!confirmed) return;
  await fetch("/api/git/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg }),
  });
  input.value = "";
  await loadGitStatus();
});

document.getElementById("btn-git-checkout").addEventListener("click", async () => {
  const branch = document.getElementById("git-new-branch-input").value.trim();
  if (!branch) return;
  const confirmed = await askConfirmation({
    title: "Switch Git Branch?",
    message: `Checkout existing branch "${branch}"?`,
    confirmLabel: "Switch Branch",
    badge: "Git Branch",
  });
  if (!confirmed) return;
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
  const confirmed = await askConfirmation({
    title: "Create & Switch Branch?",
    message: `Create a new Git branch named "${branch}" and switch into it?`,
    confirmLabel: "Create Branch",
    badge: "Git Branch",
  });
  if (!confirmed) return;
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
        <div>Model: <span class="text-primary font-medium">${escapeHtml(a.model || "cloud-default")}</span></div>
        ${isOllama ? `<div>Endpoint: <span class="text-primary">${escapeHtml(a.base_url)}</span></div>` : ""}
        <div>Approval Gates: <span class="text-primary">${escapeHtml((a.require_approval_for || []).join(", ") || "Destructive Commands Only")}</span></div>
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
  const openaiKey = (document.getElementById("setting-openai-key")?.value || "").trim();
  const openaiUrl = (document.getElementById("setting-openai-url")?.value || "").trim();
  const openaiModel = (document.getElementById("setting-openai-model")?.value || "").trim();
  const pinInput = document.getElementById("setting-access-pin");
  const pinToggle = document.getElementById("setting-pin-lock-toggle");
  if (pinInput) {
    setAccessPin(pinInput.value.trim());
  }
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ollama_base_url: ollamaUrl,
      gemini_api_key: geminiKey || null,
      openai_api_key: openaiKey || null,
      openai_base_url: openaiUrl || null,
      openai_model: openaiModel || null,
      pin_lock_enabled: pinToggle ? pinToggle.checked : null,
    }),
  });
  if (state.ws) {
    state.ws.close();
  }
  await refreshHealth();
  await loadAgents();
  connectWebSocket();
});

const pinLockToggleEl = document.getElementById("setting-pin-lock-toggle");
if (pinLockToggleEl) {
  pinLockToggleEl.addEventListener("change", async () => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin_lock_enabled: pinLockToggleEl.checked }),
    });
    await refreshHealth();
  });
}

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
        html += `<pre class="code-surface border pro-border rounded-xl p-3.5 font-mono text-[11px] overflow-x-auto my-2">`;
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

// 14. Privacy Obscure Toggle for Repository Names (When Working in Public)
const EYE_OPEN_PATH =
  "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z";
const EYE_SLASH_PATH =
  "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21";

function applyRepoObscureState(obscured) {
  state.obscureRepos = Boolean(obscured);
  document.body.classList.toggle("obscure-repos", state.obscureRepos);
  const eyePath = document.querySelector("#obscure-eye-svg path");
  if (eyePath) {
    eyePath.setAttribute("d", state.obscureRepos ? EYE_SLASH_PATH : EYE_OPEN_PATH);
  }
  const ghLabel = document.getElementById("github-obscure-label");
  if (ghLabel) {
    ghLabel.textContent = state.obscureRepos ? "🙈 Show Names" : "👁️ Hide Names";
  }
  try {
    localStorage.setItem("agy_obscure_repos", String(state.obscureRepos));
  } catch (e) {}
}

applyRepoObscureState(state.obscureRepos);

const btnToggleObscure = document.getElementById("btn-toggle-obscure");
const btnGithubObscure = document.getElementById("btn-github-obscure");
if (btnToggleObscure) {
  btnToggleObscure.addEventListener("click", () => applyRepoObscureState(!state.obscureRepos));
}
if (btnGithubObscure) {
  btnGithubObscure.addEventListener("click", () => applyRepoObscureState(!state.obscureRepos));
}

// 15. Mobile Drag-Down Pull-to-Refresh Gesture
(function initPullToRefresh() {
  const ptrIndicator = document.getElementById("ptr-indicator");
  const ptrText = document.getElementById("ptr-text");
  const ptrSpinner = document.getElementById("ptr-spinner");
  const mainEl = document.querySelector("main");
  if (!ptrIndicator || !mainEl) return;

  let startY = 0;
  let pulling = false;
  let refreshing = false;
  let currentPull = 0;
  const THRESHOLD = 62;

  function getActiveScrollContainer() {
    const map = {
      chat: document.getElementById("chat-messages"),
      files: document.getElementById("file-tree-pane"),
      github: document.getElementById("view-github"),
      git: document.getElementById("view-git"),
      agents: document.getElementById("view-agents"),
      docs: document.getElementById("view-docs"),
    };
    return map[state.activeTab] || null;
  }

  async function refreshCurrentTabView() {
    await refreshHealth();
    if (state.activeTab === "chat") {
      await loadAgents();
    } else if (state.activeTab === "files") {
      await loadFileTree();
    } else if (state.activeTab === "github") {
      await Promise.all([loadLocalWorkspaces(), loadGitHubRepos()]);
    } else if (state.activeTab === "git") {
      await loadGitStatus();
    } else if (state.activeTab === "agents") {
      await loadAgents();
    } else if (state.activeTab === "docs") {
      cachedDocsPayload = null;
      await loadInAppDocs("docs");
    }
  }

  mainEl.addEventListener(
    "touchstart",
    (e) => {
      if (refreshing || e.touches.length !== 1) return;
      const scroller = getActiveScrollContainer();
      if (scroller && scroller.scrollTop > 2) return;
      startY = e.touches[0].clientY;
      pulling = true;
      currentPull = 0;
    },
    { passive: true }
  );

  mainEl.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling || refreshing) return;
      const scroller = getActiveScrollContainer();
      if (scroller && scroller.scrollTop > 2) {
        pulling = false;
        ptrIndicator.style.height = "0px";
        return;
      }
      const deltaY = e.touches[0].clientY - startY;
      if (deltaY <= 0) {
        currentPull = 0;
        ptrIndicator.style.height = "0px";
        ptrIndicator.classList.remove("is-visible");
        return;
      }
      currentPull = Math.min(82, deltaY * 0.55);
      ptrIndicator.style.height = `${currentPull}px`;
      ptrIndicator.classList.add("is-visible");
      if (currentPull >= THRESHOLD) {
        ptrText.textContent = "Release to refresh...";
        ptrSpinner.style.transform = "rotate(180deg)";
      } else {
        ptrText.textContent = "Pull down to refresh...";
        ptrSpinner.style.transform = "rotate(0deg)";
      }
    },
    { passive: true }
  );

  mainEl.addEventListener("touchend", async () => {
    if (!pulling || refreshing) return;
    pulling = false;
    if (currentPull >= THRESHOLD) {
      refreshing = true;
      ptrIndicator.style.height = "44px";
      ptrText.textContent = "Refreshing workspace...";
      ptrSpinner.classList.add("animate-spin");
      try {
        await Promise.all([
          refreshCurrentTabView(),
          new Promise((r) => setTimeout(r, 450)),
        ]);
        ptrText.textContent = "✓ Up to date";
        ptrSpinner.classList.remove("animate-spin");
        await new Promise((r) => setTimeout(r, 450));
      } finally {
        ptrIndicator.style.height = "0px";
        ptrIndicator.classList.remove("is-visible");
        ptrSpinner.style.transform = "rotate(0deg)";
        refreshing = false;
        currentPull = 0;
      }
    } else {
      ptrIndicator.style.height = "0px";
      ptrIndicator.classList.remove("is-visible");
      currentPull = 0;
    }
  });
})();

// 16. Per-Project Chat Manager with Configurable Auto-Delete Retention (24h / 7d / 30d / Never)
const RETENTION_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: Infinity,
};

const btnPickerChat = document.getElementById("btn-picker-chat");
const pickerChatLabel = document.getElementById("picker-chat-label");
const btnPickerRetention = document.getElementById("btn-picker-retention");
const pickerRetentionLabel = document.getElementById("picker-retention-label");
const btnNewChat = document.getElementById("btn-new-chat");
const btnPinChat = document.getElementById("btn-pin-chat");
const btnDeleteChat = document.getElementById("btn-delete-chat");

const RETENTION_LABELS = {
  "24h": "Auto-del: 24h",
  "7d": "Auto-del: 7d",
  "30d": "Auto-del: 30d",
  never: "Keep Forever",
};

function getAllProjectChatsStore() {
  try {
    return JSON.parse(localStorage.getItem("ownstack_project_chats") || "{}");
  } catch (e) {
    return {};
  }
}

function saveAllProjectChatsStore(store) {
  try {
    localStorage.setItem("ownstack_project_chats", JSON.stringify(store));
  } catch (e) {}
}

function purgeExpiredChats(store) {
  const ttl = RETENTION_MS[state.chatRetention] ?? RETENTION_MS["7d"];
  if (ttl === Infinity) return store;
  const now = Date.now();
  let changed = false;
  Object.keys(store).forEach((proj) => {
    const before = store[proj].length;
    store[proj] = store[proj].filter((chat) => chat.pinned || now - (chat.updatedAt || chat.createdAt) <= ttl);
    if (store[proj].length !== before) changed = true;
  });
  if (changed) saveAllProjectChatsStore(store);
  return store;
}

function createFreshChatThread(workspaceName) {
  const store = purgeExpiredChats(getAllProjectChatsStore());
  store[workspaceName] = store[workspaceName] || [];
  const newChat = {
    id: `chat-${Date.now().toString(36)}`,
    title: "New Chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    messages: [],
  };
  store[workspaceName].unshift(newChat);
  saveAllProjectChatsStore(store);
  state.activeChatId = newChat.id;
  renderProjectChatControls(workspaceName);
  renderActiveChatThread(workspaceName);
}

function loadProjectChats(workspaceName) {
  const store = purgeExpiredChats(getAllProjectChatsStore());
  const list = store[workspaceName] || [];
  if (list.length === 0) {
    createFreshChatThread(workspaceName);
    return;
  }
  if (!list.find((c) => c.id === state.activeChatId)) {
    state.activeChatId = list[0].id;
  }
  renderProjectChatControls(workspaceName);
  renderActiveChatThread(workspaceName);
}

function renderProjectChatControls(workspaceName) {
  const store = getAllProjectChatsStore();
  const list = store[workspaceName] || [];
  const activeChat = list.find((c) => c.id === state.activeChatId) || list[0];

  if (pickerChatLabel && activeChat) {
    pickerChatLabel.textContent = `${activeChat.pinned ? "📌 " : ""}${activeChat.title}`;
  }
  if (pickerRetentionLabel) {
    pickerRetentionLabel.textContent = RETENTION_LABELS[state.chatRetention] || "Auto-del: 7d";
  }

  if (btnPinChat) {
    if (activeChat && activeChat.pinned) {
      btnPinChat.classList.add("ring-2", "ring-emerald-500/70");
    } else {
      btnPinChat.classList.remove("ring-2", "ring-emerald-500/70");
    }
  }
}

function renderActiveChatThread(workspaceName) {
  if (!chatThread) return;
  const store = getAllProjectChatsStore();
  const list = store[workspaceName] || [];
  const chat = list.find((c) => c.id === state.activeChatId);

  // Clear existing rendered messages while preserving #chat-empty-state node
  Array.from(chatThread.children).forEach((child) => {
    if (child.id !== "chat-empty-state") child.remove();
  });

  if (!chat || !chat.messages || chat.messages.length === 0) {
    if (chatEmptyState) chatEmptyState.classList.remove("hidden");
    return;
  }

  if (chatEmptyState) chatEmptyState.classList.add("hidden");
  chat.messages.forEach((m, idx) => {
    if (m.role === "user") {
      chatThread.appendChild(buildUserMessageRow(m.content, idx, m.checkpointSha || null));
    } else {
      const card = document.createElement("div");
      card.className = "space-y-2 py-2";
      card.innerHTML = `
        <div class="flex items-center gap-2.5 text-xs">
          <img src="/static/ownstack-logo.jpeg" alt="OwnStack" class="w-6 h-6 rounded-lg object-cover border pro-border shadow-sm shrink-0" />
        </div>
        <div class="pl-8">
          <div class="text-sm text-primary leading-relaxed">${formatSimpleMarkdown(m.content)}</div>
        </div>
      `;
      chatThread.appendChild(card);
    }
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessageToActiveChat(role, content, checkpointSha = null) {
  const ws = state.currentWorkspaceName || "workspace";
  const store = getAllProjectChatsStore();
  store[ws] = store[ws] || [];
  let chat = store[ws].find((c) => c.id === state.activeChatId);
  if (!chat) {
    chat = {
      id: `chat-${Date.now().toString(36)}`,
      title: "New Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      messages: [],
    };
    store[ws].unshift(chat);
    state.activeChatId = chat.id;
  }
  const msgIndex = chat.messages.length;
  chat.messages.push({ role, content, checkpointSha, ts: Date.now() });
  chat.updatedAt = Date.now();
  if (role === "user" && chat.title === "New Chat") {
    chat.title = content.slice(0, 32) + (content.length > 32 ? "..." : "");
  }
  saveAllProjectChatsStore(store);
  renderProjectChatControls(ws);
  return msgIndex;
}

if (btnPickerRetention) {
  btnPickerRetention.addEventListener("click", () => {
    openCustomPicker({
      title: "Chat Auto-Delete Duration",
      selectedValue: state.chatRetention,
      options: [
        { value: "24h", label: "Auto-delete after 24 Hours", subtitle: "Unpinned chats expire after 1 day" },
        { value: "7d", label: "Auto-delete after 7 Days", subtitle: "Recommended default retention" },
        { value: "30d", label: "Auto-delete after 30 Days", subtitle: "Keep unpinned chats for a month" },
        { value: "never", label: "Keep Forever", subtitle: "Never auto-delete any chats" },
      ],
      onSelect: (val) => {
        state.chatRetention = val;
        try {
          localStorage.setItem("ownstack_chat_retention", val);
        } catch (e) {}
        loadProjectChats(state.currentWorkspaceName);
      },
    });
  });
}

if (btnPickerChat) {
  btnPickerChat.addEventListener("click", () => {
    const ws = state.currentWorkspaceName || "workspace";
    const store = getAllProjectChatsStore();
    const list = store[ws] || [];
    openCustomPicker({
      title: `Chats in ${ws}`,
      selectedValue: state.activeChatId,
      options: list.map((c) => ({
        value: c.id,
        label: `${c.pinned ? "📌 " : ""}${c.title}`,
        subtitle: `${(c.messages || []).length} messages • ${new Date(c.updatedAt || c.createdAt).toLocaleDateString()}`,
      })),
      onSelect: (chosenId) => {
        state.activeChatId = chosenId;
        renderProjectChatControls(ws);
        renderActiveChatThread(ws);
      },
    });
  });
}

if (btnNewChat) {
  btnNewChat.addEventListener("click", () => createFreshChatThread(state.currentWorkspaceName));
}

if (btnPinChat) {
  btnPinChat.addEventListener("click", () => {
    const ws = state.currentWorkspaceName;
    const store = getAllProjectChatsStore();
    const chat = (store[ws] || []).find((c) => c.id === state.activeChatId);
    if (chat) {
      chat.pinned = !chat.pinned;
      saveAllProjectChatsStore(store);
      renderProjectChatControls(ws);
    }
  });
}

if (btnDeleteChat) {
  btnDeleteChat.addEventListener("click", async () => {
    const ws = state.currentWorkspaceName;
    const store = getAllProjectChatsStore();
    const activeChat = (store[ws] || []).find((c) => c.id === state.activeChatId);
    const title = activeChat ? activeChat.title : "this chat";
    const confirmed = await askConfirmation({
      title: "Delete Chat Thread?",
      message: `Are you sure you want to permanently delete "${title}" from project ${ws}? This cannot be undone.`,
      confirmLabel: "Delete Chat",
      badge: "Delete",
      destructive: true,
    });
    if (!confirmed) return;

    store[ws] = (store[ws] || []).filter((c) => c.id !== state.activeChatId);
    saveAllProjectChatsStore(store);
    state.activeChatId = null;
    loadProjectChats(ws);
  });
}

loadProjectChats(state.currentWorkspaceName);
initApp();
