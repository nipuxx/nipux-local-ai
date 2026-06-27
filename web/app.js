const state = {
  status: null,
  models: [],
  chats: [],
  agents: [],
  activeAgentId: null,
  activeChatId: null,
  messages: [],
  memories: [],
  browserShots: {},
  browserErrors: {},
  runtime: null,
  permissions: [],
  browserActions: [],
  settingsStatus: null,
  mediaCapabilities: null,
  mediaRuntimePlan: null,
  mediaJobs: [],
  speechPlayback: null,
  voiceRecorder: null,
  readiness: null,
  setupActions: null,
  launchProfile: null,
  localSupervisor: null,
  diagnostics: null,
  apiKeys: [],
};

const IMPORT_MAX_FILES = 80;
const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const IMPORT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
]);
const IMPORT_MIME_TYPES = new Set([
  "application/json",
  "application/jsonl",
  "application/x-ndjson",
  "application/xml",
  "application/yaml",
]);

const $ = (selector) => document.querySelector(selector);
const h = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function authHeaders() {
  const key = localStorage.getItem("nipuxApiKey")?.trim();
  return key ? { "x-api-key": key } : {};
}

async function maybeSetApiKey(res) {
  if (![401, 403].includes(res.status)) return false;
  const text = await res.text();
  if (!state.status?.auth?.required) throw new Error(text || res.statusText);
  const key = prompt("Nipux API key");
  if (!key) throw new Error(text || "API key is required.");
  localStorage.setItem("nipuxApiKey", key);
  return true;
}

async function api(path, options = {}) {
  const request = () => fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  let res = await request();
  if (await maybeSetApiKey(res)) res = await request();
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

async function fetchWithAuth(path, options = {}) {
  const request = () => fetch(path, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  let res = await request();
  if (await maybeSetApiKey(res)) res = await request();
  return res;
}

function setStatus(text) {
  $("#statusText").textContent = text;
}

function setVoiceStatus(text = "") {
  $("#voiceStatus").textContent = text;
}

function messageBody(el) {
  return el.querySelector(".message-content") || el;
}

function messageText(el) {
  return messageBody(el).textContent || "";
}

function setMessageText(el, content = "") {
  messageBody(el).textContent = content;
  const button = el.querySelector(".chat-speak");
  if (button) button.disabled = !content.trim();
}

function setMessageSpeechStatus(el, text = "") {
  const status = el.querySelector(".speech-status");
  if (status) status.textContent = text;
}

function stopSpeechPlayback() {
  if (!state.speechPlayback) return;
  state.speechPlayback.audio.pause();
  state.speechPlayback.audio.currentTime = 0;
  URL.revokeObjectURL(state.speechPlayback.url);
  state.speechPlayback.button.textContent = "Play";
  state.speechPlayback.button.disabled = false;
  setMessageSpeechStatus(state.speechPlayback.message, "");
  state.speechPlayback = null;
}

function transcriptionText(payload) {
  return payload?.text || payload?.result?.text || payload?.data?.text || "";
}

async function parseErrorResponse(res) {
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json.error?.message || json.error || text || res.statusText;
  } catch {
    return text || res.statusText;
  }
}

function currentSettings() {
  return (
    state.settingsStatus?.settings ||
    state.status?.settings || {
      searxngUrl: "",
      browserHeadless: true,
      devMode: false,
      defaultModelPreset: "balanced",
      imageWorkerUrl: "",
      speechWorkerUrl: "",
      transcriptionWorkerUrl: "",
      videoWorkerUrl: "",
    }
  );
}

function renderModelSelectors() {
  if (!state.models.length) return;
  const current = currentSettings().defaultModelPreset || "balanced";
  const options = state.models
    .map((model) => `<option value="${h(model.id)}">${h(model.label)}${["fast", "balanced", "smart"].includes(model.id) ? "" : " · custom"}</option>`)
    .join("");
  for (const select of [$("#presetSelect"), $("#settingsDefaultPreset")]) {
    const previous = select.value || current;
    select.innerHTML = options;
    select.value = state.models.some((model) => model.id === previous) ? previous : current;
  }
}

function applySettingsToUi() {
  const settings = currentSettings();
  document.body.classList.toggle("dev-mode", Boolean(settings.devMode));
  renderModelSelectors();
  $("#settingsDefaultPreset").value = settings.defaultModelPreset || "balanced";
  $("#settingsSearxngUrl").value = settings.searxngUrl || "";
  $("#settingsBrowserHeadless").checked = settings.browserHeadless !== false;
  $("#settingsDevMode").checked = Boolean(settings.devMode);
  $("#settingsImageWorkerUrl").value = settings.imageWorkerUrl || "";
  $("#settingsSpeechWorkerUrl").value = settings.speechWorkerUrl || "";
  $("#settingsTranscriptionWorkerUrl").value = settings.transcriptionWorkerUrl || "";
  $("#settingsVideoWorkerUrl").value = settings.videoWorkerUrl || "";
  $("#settingsApiKey").value = localStorage.getItem("nipuxApiKey") || "";

  const env = state.settingsStatus?.env || {
    bindHost: state.status?.bindHost,
    publicApi: state.status?.publicApi,
    authRequired: state.status?.auth?.required,
    authConfigured: state.status?.auth?.configured,
  };
  $("#settingsAuthStatus").innerHTML = `
    <div>
      <strong>${env.authRequired ? "API key required" : "Local private mode"}</strong>
      <div class="meta">Bind: ${h(env.bindHost || "127.0.0.1")} · Public API: ${env.publicApi ? "on" : "off"}</div>
      <div class="meta">Server keys: ${h((env.envKeyCount || 0) + (env.storedKeyCount || 0))} total · ${h(env.storedKeyCount || 0)} managed here</div>
    </div>`;
  $("#settingsStatus").textContent = JSON.stringify({ settings, env }, null, 2);
}

function addMessage(role, content = "") {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  const body = document.createElement("div");
  body.className = "message-content";
  body.textContent = content;
  el.appendChild(body);
  if (role === "assistant") {
    const tools = document.createElement("div");
    tools.className = "message-tools";
    tools.innerHTML = `
      <button class="chat-speak" type="button" title="Play locally generated speech" ${content.trim() ? "" : "disabled"}>Play</button>
      <span class="speech-status" aria-live="polite"></span>`;
    el.appendChild(tools);
  }
  $("#messages").appendChild(el);
  el.scrollIntoView({ block: "end" });
  return el;
}

function renderMessages() {
  $("#messages").innerHTML = "";
  if (!state.messages.length) {
    addMessage("assistant", "Local chat is ready. Use dev mode now, or start llama.cpp and run the same UI against your model.");
    return;
  }
  for (const message of state.messages) addMessage(message.role, message.content);
}

function renderChatList() {
  $("#chatList").innerHTML =
    state.chats
      .map(
        (chat) =>
          `<button class="chat-item ${chat.id === state.activeChatId ? "active" : ""}" data-chat-id="${h(chat.id)}">${h(chat.title)}</button>`,
      )
      .join("") || `<div class="meta">No chats yet.</div>`;
}

async function loadChats() {
  const data = await api("/api/chats");
  state.chats = data.chats;
  renderChatList();
}

async function openChat(id) {
  const data = await api(`/api/chats/${id}`);
  state.activeChatId = data.chat.id;
  state.messages = data.messages.map((message) => ({ role: message.role, content: message.content }));
  $("#presetSelect").value = data.chat.modelPreset || $("#presetSelect").value;
  renderMessages();
  await loadChats();
}

async function createNewChat() {
  const data = await api("/api/chats", {
    method: "POST",
    body: JSON.stringify({ modelPreset: $("#presetSelect").value }),
  });
  state.activeChatId = data.chat.id;
  state.messages = [];
  renderMessages();
  await loadChats();
}

async function ensureActiveChat() {
  if (!state.activeChatId) await createNewChat();
  return state.activeChatId;
}

async function loadStatus() {
  state.status = await api("/api/status");
  const hw = state.status.hardware;
  const settings = currentSettings();
  $("#presetSelect").value = settings.defaultModelPreset || hw.recommendedPreset || "balanced";
  const label = state.status.fakeLlm ? "dev backend" : `${hw.accelerator} ${hw.totalRamGb}GB`;
  setStatus(settings.devMode ? `${label} · dev` : label);
  $("#devStatus").textContent = JSON.stringify(state.status, null, 2);
  if (!state.settingsStatus) state.settingsStatus = { settings: state.status.settings, env: null };
  applySettingsToUi();
}

async function loadSettings() {
  state.settingsStatus = await api("/api/settings");
  $("#presetSelect").value = state.settingsStatus.settings.defaultModelPreset || $("#presetSelect").value;
  applySettingsToUi();
}

async function loadApiKeys() {
  const data = await api("/api/api-keys");
  state.apiKeys = data.keys;
  $("#serverApiKeys").innerHTML =
    state.apiKeys
      .map(
        (key) => `
          <div>
            <strong>${h(key.label)}</strong>
            <div class="meta">${h(key.prefix)} · created ${h(key.createdAt)}${key.lastUsedAt ? ` · used ${h(key.lastUsedAt)}` : ""}</div>
            <button class="revoke-api-key" data-id="${h(key.id)}">Revoke</button>
          </div>`,
      )
      .join("") || `<div class="meta">No managed server keys.</div>`;
}

async function saveSettings() {
  const apiKey = $("#settingsApiKey").value.trim();
  if (apiKey) localStorage.setItem("nipuxApiKey", apiKey);
  const body = {
    defaultModelPreset: $("#settingsDefaultPreset").value,
    searxngUrl: $("#settingsSearxngUrl").value,
    browserHeadless: $("#settingsBrowserHeadless").checked,
    devMode: $("#settingsDevMode").checked,
    imageWorkerUrl: $("#settingsImageWorkerUrl").value,
    speechWorkerUrl: $("#settingsSpeechWorkerUrl").value,
    transcriptionWorkerUrl: $("#settingsTranscriptionWorkerUrl").value,
    videoWorkerUrl: $("#settingsVideoWorkerUrl").value,
  };
  state.settingsStatus = await api("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (state.status) state.status.settings = state.settingsStatus.settings;
  $("#presetSelect").value = state.settingsStatus.settings.defaultModelPreset;
  applySettingsToUi();
  await Promise.all([loadReadiness(), loadSetupActions(), loadLocalSupervisor()]);
}

async function loadModels() {
  const data = await api("/api/models");
  state.models = data.models;
  renderModelSelectors();
  const currentDefault = currentSettings().defaultModelPreset || "balanced";
  $("#modelList").innerHTML = state.models
    .map(
      (model) => `
      <div class="model">
        <strong>${model.label}</strong>
        <div class="meta">${model.family} ${model.parametersB}B ${model.quant}</div>
        <div class="meta">${model.repo}</div>
        <div class="meta">State: ${model.state} · RAM: ${model.estimatedRamGb}GB</div>
        ${model.localPath ? `<div class="meta">${h(model.localPath)}</div>` : ""}
        ${
          model.state === "missing" || model.state === "error"
            ? `<button class="install-model" data-model-id="${h(model.id)}">Install</button>`
            : model.state === "downloading"
              ? `<button disabled>Downloading</button>`
              : model.id === currentDefault
                ? `<button disabled>Default</button>`
                : `<button class="set-default-model" data-model-id="${h(model.id)}">Use</button>`
        }
      </div>`,
    )
    .join("");
}

async function loadRuntime() {
  const data = await api("/api/runtime/status");
  state.runtime = data;
  $("#runtimeStatus").innerHTML = [
    ["Process", data.running ? `running ${data.pid}` : "stopped"],
    ["Backend", data.backend.ok ? "available" : "offline"],
    ["Model", data.modelPreset || "none"],
    ["Port", data.port],
  ]
    .map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${h(value)}</strong></div>`)
    .join("");
  $("#runtimeOutput").textContent = JSON.stringify(
    {
      command: data.command,
      backend: data.backend,
      logs: data.logs,
    },
    null,
    2,
  );
}

async function loadReadiness() {
  const report = await api("/api/readiness");
  state.readiness = report;
  $("#readinessHero").innerHTML = `
    <div>
      <strong>${h(report.usable ? "Ready" : "Needs setup")}</strong>
      <div class="meta">${h(report.headline)}</div>
      <div class="meta">${h(report.localUrl)} · ${h(report.bindHost)}${report.publicApi ? " · public API" : ""}</div>
    </div>
    <div class="readiness-counts">
      <span>${h(report.counts.ready)} ready</span>
      <span>${h(report.counts.needs_setup)} setup</span>
      <span>${h(report.counts.optional)} optional</span>
      <span>${h(report.counts.blocked)} blocked</span>
    </div>`;
  $("#readinessGrid").innerHTML = report.items
    .map(
      (item) => `
        <div class="readiness-item readiness-${h(item.status)}">
          <div>
            <strong>${h(item.label)}</strong>
            <span>${h(item.status.replace("_", " "))}</span>
          </div>
          <div class="meta">${h(item.detail)}</div>
          ${item.fix ? `<div class="meta">Fix: ${h(item.fix)}</div>` : ""}
        </div>`,
    )
    .join("");
  $("#readinessSteps").innerHTML =
    report.nextSteps.map((step) => `<div>${h(step)}</div>`).join("") || `<div class="meta">No setup steps required.</div>`;
}

function setupCommandMarkup(item) {
  return item.commands
    .map(
      (command) => `
        <div class="command-row">
          <div>
            <span>${h(command.label)}</span>
            <code>${h(command.command)}</code>
          </div>
          ${command.copyable ? `<button class="copy-command" data-command="${h(command.command)}">Copy</button>` : ""}
        </div>`,
    )
    .join("");
}

function quotedCommandPart(value = "") {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function supervisorCommand(process) {
  const env = Object.entries(process.env || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${quotedCommandPart(String(value))}`);
  const command = (process.command || []).map(quotedCommandPart);
  return [...env, ...command].join(" ");
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function loadSetupActions() {
  const data = await api("/api/setup/actions");
  state.setupActions = data;
  $("#setupActions").innerHTML =
    data.actions
      .map(
        (item) => `
          <div class="setup-action setup-action-${h(item.status)}">
            <div>
              <strong>${h(item.label)}</strong>
              <span>${h(item.status)}</span>
            </div>
            <div class="meta">${h(item.description)}</div>
            ${item.reason ? `<div class="meta">${h(item.reason)}</div>` : ""}
            ${setupCommandMarkup(item)}
          </div>`,
      )
      .join("") || `<div class="meta">No setup actions required.</div>`;
}

async function loadLaunchProfile() {
  const profile = await api("/api/launch/profile");
  state.launchProfile = profile;
  $("#launchProfile").innerHTML = `
    <div>
      <h2>Launch Profile</h2>
      <div class="meta">${h(profile.mode)} · ${h(profile.hardware.accelerator)} · ${h(profile.hardware.totalRamGb)}GB RAM</div>
      <div class="meta">${h(profile.files.profileJson)}</div>
    </div>
    <div class="launch-command">
      <span>Local</span>
      <code>${h(profile.commands.oneCommandLocal)}</code>
    </div>
    <div class="launch-command">
      <span>Dev</span>
      <code>${h(profile.commands.oneCommandDev)}</code>
    </div>
    <div class="launch-command">
      <span>Model</span>
      <code>${h(profile.commands.model)}</code>
    </div>
    <div class="launch-command">
      <span>API</span>
      <code>${h(profile.apiBaseUrl)}</code>
    </div>`;
}

async function loadLocalSupervisor() {
  const plan = await api("/api/launch/supervisor");
  state.localSupervisor = plan;
  $("#localSupervisor").innerHTML = `
    <div>
      <h2>Local Supervisor</h2>
      <div class="meta">${h(plan.appUrl)}</div>
    </div>
    <div class="launch-command">
      <span>Run</span>
      <code>${h("bun run local")}</code>
    </div>
    <div class="local-supervisor-counts">
      <span>${h(plan.ready.length)} start</span>
      <span>${h(plan.skipped.length)} skipped</span>
    </div>
    <div class="local-process-list">
      ${plan.processes
        .map(
          (process) => `
            <div class="local-process local-process-${h(process.status)}">
              <div>
                <strong>${h(process.label)}</strong>
                <span>${h(process.status)}</span>
              </div>
              <code>${h(supervisorCommand(process))}</code>
              ${process.reason ? `<div class="meta">${h(process.reason)}</div>` : ""}
            </div>`,
        )
        .join("")}
    </div>
    <div class="local-supervisor-steps">
      ${plan.nextSteps.map((step) => `<div class="meta">${h(step)}</div>`).join("") || `<div class="meta">No local supervisor setup steps.</div>`}
    </div>`;
}

async function loadUsage() {
  const data = await api("/api/usage/summary");
  const s = data.summary;
  $("#usageSummary").innerHTML = [
    ["Requests", s.requests],
    ["Input tokens", s.tokensIn],
    ["Output tokens", s.tokensOut],
    ["Avg latency", `${Math.round(s.latencyMs)}ms`],
    ["Errors", s.errors],
  ]
    .map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
  $("#usageTimeline").innerHTML = data.timeline
    .map(
      (event) => `
        <div>
          <strong>${event.kind} ${event.status}</strong>
          <div class="meta">${event.model || "n/a"} · ${event.latencyMs}ms · ${event.createdAt}</div>
        </div>`,
    )
    .join("");
}

async function loadDiagnostics() {
  const data = await api("/api/diagnostics");
  state.diagnostics = data;
  const storageBytes = Object.values(data.storage || {}).reduce((total, item) => total + (item.bytes || 0), 0);
  $("#diagnosticsSummary").innerHTML = [
    ["Generated", data.generatedAt],
    ["Readiness", data.readiness?.usable ? "usable" : "needs setup"],
    ["Runtime", data.runtime?.running ? `running ${data.runtime.pid}` : "stopped"],
    ["Supervisor", `${data.supervisor?.ready?.length || 0} start · ${data.supervisor?.skipped?.length || 0} skipped`],
    ["Storage", formatBytes(storageBytes)],
    ["Auth", data.app?.auth?.configured ? `${data.app.auth.keyCount} key(s)` : "local private mode"],
  ]
    .map(([label, value]) => `<div><span>${h(label)}</span><strong>${h(value)}</strong></div>`)
    .join("");
  $("#diagnosticsOutput").textContent = JSON.stringify(data, null, 2);
}

function renderMediaResult(target, payload) {
  const result = payload.result || payload;
  const data = result.data?.[0] || result;
  if (data.b64_json) {
    target.innerHTML = `<img class="generated-media" src="data:image/png;base64,${h(data.b64_json)}" alt="Generated image" />`;
    return;
  }
  if (data.dataUrl || result.dataUrl) {
    const url = data.dataUrl || result.dataUrl;
    const mime = data.mime || result.mime || "";
    if (mime.startsWith("audio/")) target.innerHTML = `<audio controls src="${h(url)}"></audio>`;
    else if (mime.startsWith("video/")) target.innerHTML = `<video controls src="${h(url)}"></video>`;
    else target.innerHTML = `<a href="${h(url)}" target="_blank" rel="noreferrer">Open generated media</a>`;
    return;
  }
  if (result.text) {
    target.textContent = result.text;
    return;
  }
  target.textContent = JSON.stringify(payload, null, 2);
}

function mediaRuntimeSetting(runtime) {
  if (runtime.source === "builtin") return "Built-in system speech";
  return `${runtime.envVar}=${runtime.workerUrl || runtime.defaultUrl}`;
}

function mediaRuntimeHealth(runtime) {
  if (runtime.status === "offline") return `Offline: ${runtime.health?.detail || "worker did not respond"}`;
  return runtime.health?.detail || runtime.setup || "";
}

async function loadMedia() {
  const [capabilities, runtimePlan, jobs] = await Promise.all([
    api("/api/media/capabilities"),
    api("/api/media/runtimes"),
    api("/api/media/jobs"),
  ]);
  state.mediaCapabilities = capabilities.capabilities;
  state.mediaRuntimePlan = runtimePlan;
  state.mediaJobs = jobs.jobs;
  $("#mediaRuntimePlan").innerHTML = state.mediaRuntimePlan.runtimes
    .map(
      (runtime) => `
        <div class="media-runtime ${runtime.status === "ready" ? "" : "media-warn"}">
          <div>
            <strong>${h(runtime.label)}</strong>
            <span>${h(runtime.status)} · ${runtime.recommended ? "recommended" : "optional"}</span>
          </div>
          <div class="meta">${h(runtime.workerLabel)}</div>
          <div class="meta">${h(runtime.hardwareFit)}</div>
          <code>${h(mediaRuntimeSetting(runtime))}</code>
          <div class="meta">${h(mediaRuntimeHealth(runtime))}</div>
          <div class="meta">${h(runtime.endpoint)}</div>
        </div>`,
    )
    .join("");
  $("#mediaCapabilities").innerHTML = Object.values(state.mediaCapabilities)
    .map(
      (capability) => `
        <div class="stat ${capability.status === "ready" ? "" : "media-warn"}">
          <span>${h(capability.label)}</span>
          <strong>${h(capability.status)}</strong>
          <div class="meta">${h(capability.source === "builtin" ? capability.setup : capability.workerUrl || capability.setup)}</div>
        </div>`,
    )
    .join("");
  $("#mediaJobs").innerHTML =
    state.mediaJobs
      .map(
        (job) => `
          <div>
            <strong>${h(job.kind)} · ${h(job.status)}</strong>
            <div class="meta">${h(job.prompt || "no prompt")} · ${h(job.createdAt)}</div>
            ${job.error ? `<div class="browser-error">${h(job.error)}</div>` : ""}
          </div>`,
      )
      .join("") || `<div class="meta">No media jobs yet.</div>`;
}

async function loadAgents() {
  const data = await api("/api/agents");
  state.agents = data.agents;
  state.activeAgentId ??= data.agents[0]?.id ?? null;
  $("#agentRuns").innerHTML = data.runs
    .map(
      (run) => `
        <div>
          <strong>${run.agentName} · ${run.status}</strong>
          <div class="meta">${run.input}</div>
          <div>${run.output || ""}</div>
        </div>`,
    )
    .join("");
  const browsers = await api("/api/browsers");
  $("#browserList").innerHTML =
    browsers.sessions
      .map(
        (session) => `
          <div class="browser-card" data-browser-id="${h(session.id)}">
            <div class="browser-head">
              <div>
                <strong>${h(session.label)}</strong>
                <div class="meta">${h(session.status)} · ${h(session.url || "about:blank")}</div>
              </div>
              <button class="browser-close" data-id="${h(session.id)}">Close</button>
            </div>
            <div class="browser-controls">
              <button class="browser-open" data-id="${h(session.id)}">Open</button>
              <input class="browser-url" value="${h(session.url || "about:blank")}" />
              <button class="browser-go" data-id="${h(session.id)}">Go</button>
              <button class="browser-refresh" data-id="${h(session.id)}">Shot</button>
            </div>
            <div class="browser-controls">
              <input class="browser-text" placeholder="Type into focused page element" />
              <button class="browser-type" data-id="${h(session.id)}">Type</button>
              <button class="browser-enter" data-id="${h(session.id)}">Enter</button>
            </div>
            ${
              state.browserErrors[session.id]
                ? `<div class="browser-error">${h(state.browserErrors[session.id])}</div>`
                : ""
            }
            ${
              state.browserShots[session.id]
                ? `<img class="browser-preview" data-id="${h(session.id)}" src="${state.browserShots[session.id]}" alt="Browser preview" />`
                : `<div class="browser-empty">No screenshot yet</div>`
            }
          </div>`,
      )
      .join("") || `<div class="meta">No browser sessions yet.</div>`;
  if (state.activeAgentId) await loadMemories();
  await Promise.all([loadPermissions(), loadBrowserActions()]);
}

async function loadPermissions() {
  const data = await api("/api/permissions?status=pending");
  state.permissions = data.requests;
  $("#permissionList").innerHTML =
    data.requests
      .map(
        (request) => `
          <div>
            <strong>${h(request.action)} · ${h(request.risk)}</strong>
            <div class="meta">${h(request.reason || "No reason provided")}</div>
            <div class="meta">${h(request.browserSessionId || "")}</div>
            <button class="permission-approve" data-id="${h(request.id)}">Approve</button>
            <button class="permission-deny" data-id="${h(request.id)}">Deny</button>
          </div>`,
      )
      .join("") || `<div class="meta">No pending approvals.</div>`;
}

async function loadBrowserActions() {
  const data = await api("/api/browser-actions?limit=80");
  state.browserActions = data.events;
  $("#browserActionList").innerHTML =
    data.events
      .map(
        (event) => `
          <div>
            <strong>${h(event.action)} · ${h(event.status)} · ${h(event.actor)}</strong>
            <div class="meta">${h(event.risk)} · ${h(event.url || "")}</div>
            <div class="meta">${h(event.createdAt)}</div>
          </div>`,
      )
      .join("") || `<div class="meta">No browser actions yet.</div>`;
}

async function loadMemories(query = "") {
  if (!state.activeAgentId) {
    $("#memoryList").innerHTML = `<div class="meta">No agent yet.</div>`;
    return;
  }
  const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
  const data = await api(`/api/agents/${state.activeAgentId}/memories${suffix}`);
  state.memories = data.memories;
  $("#memoryList").innerHTML =
    data.memories
      .map(
        (memory) => `
          <div>
            <div class="row">
              <select class="memory-kind">
                ${["fact", "profile", "procedure", "task", "summary"]
                  .map((kind) => `<option value="${kind}" ${kind === memory.kind ? "selected" : ""}>${kind}</option>`)
                  .join("")}
              </select>
              <input class="memory-importance" type="number" min="1" max="5" value="${h(memory.importance)}" />
            </div>
            <input class="memory-summary" value="${h(memory.summary || "")}" placeholder="Memory summary" />
            <textarea class="memory-edit-content" rows="3">${h(memory.content)}</textarea>
            <div class="meta">
              ${h(memory.source || "manual")}${memory.sourceId ? ` · ${h(memory.sourceId)}` : ""}
              · ${h(memory.tokenCount || 0)} tokens
              · ${memory.archivedAt ? `archived ${h(memory.archivedAt)}` : h(memory.createdAt)}
            </div>
            <button class="memory-save" data-id="${h(memory.id)}">Save</button>
            <button class="memory-delete" data-id="${h(memory.id)}">Delete</button>
          </div>`,
      )
      .join("") || `<div class="meta">No memories yet.</div>`;
}

async function loadDocuments() {
  const data = await api("/api/search/documents");
  $("#documentList").innerHTML =
    data.documents
      .map(
        (doc) => `
          <div>
            <strong>${h(doc.title)}</strong>
            <div class="meta">${h(doc.path || "manual")} · ${h(doc.createdAt)}</div>
            <div>${h(doc.snippet || "")}</div>
            <button class="document-delete" data-id="${h(doc.id)}">Delete</button>
          </div>`,
      )
      .join("") || `<div class="meta">No indexed documents yet.</div>`;
}

function importFilePath(file) {
  return file.webkitRelativePath || file.name;
}

function importFileExtension(file) {
  const name = importFilePath(file).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function importSkipReason(file) {
  if (file.size <= 0) return "Empty file.";
  if (file.size > IMPORT_MAX_BYTES) return `Larger than ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)} MB.`;
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("text/") || IMPORT_MIME_TYPES.has(mime) || IMPORT_EXTENSIONS.has(importFileExtension(file))) return "";
  return "Unsupported file type.";
}

function importDetails(label, items) {
  if (!items.length) return [];
  return [`${label}:`, ...items.slice(0, 6).map((item) => `- ${item.path || item.title || `item ${item.index + 1}`}: ${item.reason || item.error}`)];
}

async function indexSelectedFiles() {
  const output = $("#fileIndexOutput");
  const files = [...Array.from($("#documentFiles").files || []), ...Array.from($("#documentFolder").files || [])];
  if (!files.length) {
    output.textContent = "No files selected.";
    return;
  }

  output.textContent = "Reading files...";
  const documents = [];
  const skipped = [];
  const errors = [];
  const seen = new Set();

  for (const file of files) {
    const path = importFilePath(file);
    if (seen.has(path)) {
      skipped.push({ path, reason: "Duplicate selection." });
      continue;
    }
    seen.add(path);

    if (documents.length >= IMPORT_MAX_FILES) {
      skipped.push({ path, reason: `Import is limited to ${IMPORT_MAX_FILES} files at once.` });
      continue;
    }

    const reason = importSkipReason(file);
    if (reason) {
      skipped.push({ path, reason });
      continue;
    }

    try {
      const body = await file.text();
      if (!body.trim()) {
        skipped.push({ path, reason: "No text content." });
        continue;
      }
      documents.push({ title: file.name, path, body });
    } catch (error) {
      errors.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }

  let imported = { indexed: [], skipped: [], errors: [] };
  if (documents.length) {
    imported = await api("/api/search/documents/bulk", {
      method: "POST",
      body: JSON.stringify({ documents, maxDocuments: IMPORT_MAX_FILES, maxBytes: IMPORT_MAX_BYTES }),
    });
  }

  const allSkipped = [...skipped, ...(imported.skipped || [])];
  const allErrors = [...errors, ...(imported.errors || [])];
  const lines = [
    `Indexed ${imported.indexed.length} file${imported.indexed.length === 1 ? "" : "s"}.`,
    `Skipped ${allSkipped.length}. Errors ${allErrors.length}.`,
    ...importDetails("Skipped", allSkipped),
    ...importDetails("Errors", allErrors),
  ];
  output.textContent = lines.join("\n");
  await Promise.all([loadDocuments(), loadUsage()]);
}

function clearSelectedFiles() {
  $("#documentFiles").value = "";
  $("#documentFolder").value = "";
  $("#fileIndexOutput").textContent = "";
}

async function refreshBrowserScreenshot(id) {
  try {
    const data = await api(`/api/browsers/${id}/screenshot`);
    state.browserShots[id] = data.dataUrl;
    delete state.browserErrors[id];
  } catch (error) {
    state.browserErrors[id] = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([loadAgents(), loadUsage()]);
}

async function playChatSpeech(button) {
  const message = button.closest(".message");
  if (!message) return;
  const input = messageText(message).trim();
  if (!input) return;

  if (state.speechPlayback?.button === button) {
    stopSpeechPlayback();
    return;
  }
  stopSpeechPlayback();

  button.disabled = true;
  button.textContent = "Wait";
  setMessageSpeechStatus(message, "Preparing");
  try {
    const res = await fetchWithAuth("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input, voice: "alloy" }),
    });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.speechPlayback = { audio, url, button, message };
    audio.addEventListener("ended", () => {
      if (state.speechPlayback?.audio === audio) stopSpeechPlayback();
    }, { once: true });
    audio.addEventListener("error", () => {
      if (state.speechPlayback?.audio !== audio) return;
      stopSpeechPlayback();
      setMessageSpeechStatus(message, "Playback failed");
    }, { once: true });
    button.disabled = false;
    button.textContent = "Stop";
    setMessageSpeechStatus(message, "Playing");
    await audio.play();
    await loadUsage();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    stopSpeechPlayback();
    button.textContent = "Play";
    button.disabled = false;
    setMessageSpeechStatus(message, errorMessage);
  }
}

function bestAudioMime() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"];
  return options.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

async function transcribeVoiceBlob(blob) {
  const form = new FormData();
  const extension = blob.type.includes("mp4") ? "m4a" : blob.type.includes("wav") ? "wav" : "webm";
  form.set("file", new File([blob], `voice.${extension}`, { type: blob.type || "audio/webm" }));
  const res = await fetchWithAuth("/v1/audio/transcriptions", {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await parseErrorResponse(res));
  const payload = await res.json();
  const text = transcriptionText(payload).trim();
  if (!text) throw new Error("The local transcription worker did not return text.");
  return text;
}

async function finishVoiceInput() {
  const session = state.voiceRecorder;
  if (!session) return;
  state.voiceRecorder = null;
  session.stream.getTracks().forEach((track) => track.stop());
  session.button.disabled = true;
  session.button.textContent = "Record";
  setVoiceStatus("Transcribing locally");
  try {
    const blob = new Blob(session.chunks, { type: session.mime || "audio/webm" });
    const text = await transcribeVoiceBlob(blob);
    $("#chatInput").value = text;
    $("#chatInput").focus();
    setVoiceStatus("Ready to send");
    await Promise.all([loadMedia(), loadUsage()]);
  } catch (error) {
    setVoiceStatus(error instanceof Error ? error.message : String(error));
  } finally {
    session.button.disabled = false;
  }
}

async function toggleVoiceInput(button) {
  if (state.voiceRecorder) {
    state.voiceRecorder.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setVoiceStatus("Microphone recording is not available in this browser.");
    return;
  }

  button.disabled = true;
  setVoiceStatus("Requesting microphone");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = bestAudioMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    state.voiceRecorder = { recorder, stream, chunks, button, mime: recorder.mimeType || mime };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("stop", finishVoiceInput, { once: true });
    recorder.start();
    button.textContent = "Stop";
    setVoiceStatus("Recording");
  } catch (error) {
    setVoiceStatus(error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
  }
}

function browserCard(target) {
  return target.closest(".browser-card");
}

async function sendChat(event) {
  event.preventDefault();
  const input = $("#chatInput");
  const content = input.value.trim();
  if (!content) return;
  const chatId = await ensureActiveChat();
  input.value = "";
  state.messages.push({ role: "user", content });
  addMessage("user", content);
  const assistant = addMessage("assistant", "");
  const model = $("#presetSelect").value;

  const res = await fetchWithAuth(`/api/chats/${chatId}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelPreset: model, content, stream: true }),
  });

  if (!res.ok || !res.body) {
    setMessageText(assistant, await res.text());
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || "";
        full += delta;
        setMessageText(assistant, full);
      } catch {
        // Ignore malformed SSE fragments from alternate backends.
      }
    }
  }
  state.messages.push({ role: "assistant", content: full });
  await Promise.all([loadUsage(), loadChats()]);
}

async function runAgentForm(event) {
  event.preventDefault();
  const input = $("#agentInput").value.trim();
  if (!input) return;
  $("#agentOutput").textContent = "Running...";
  const data = await api("/api/agents/run", {
    method: "POST",
    body: JSON.stringify({ input, agentId: state.activeAgentId, modelPreset: $("#presetSelect").value }),
  });
  $("#agentOutput").textContent = data.output;
  $("#agentInput").value = "";
  await Promise.all([loadAgents(), loadUsage()]);
}

async function saveMemory(event) {
  event.preventDefault();
  if (!state.activeAgentId) return;
  const content = $("#memoryContent").value.trim();
  if (!content) return;
  await api(`/api/agents/${state.activeAgentId}/memories`, {
    method: "POST",
    body: JSON.stringify({
      kind: $("#memoryKind").value,
      content,
      importance: 4,
    }),
  });
  $("#memoryContent").value = "";
  await loadMemories();
}

async function runSearch(event) {
  event.preventDefault();
  const query = $("#searchInput").value.trim();
  if (!query) return;
  const [local, web] = await Promise.all([
    api("/api/search/local", { method: "POST", body: JSON.stringify({ query }) }),
    api("/api/search/web", { method: "POST", body: JSON.stringify({ query }) }),
  ]);
  $("#searchResults").innerHTML = [...local.results, ...web.results]
    .map(
      (result) => `
        <div>
          <strong>${result.title}</strong>
          <div class="meta">${result.source}${result.url ? ` · ${result.url}` : result.path ? ` · ${result.path}` : ""}</div>
          <div>${result.snippet}</div>
        </div>`,
    )
    .join("");
  await loadUsage();
}

async function runImage(event) {
  event.preventDefault();
  const prompt = $("#imagePrompt").value.trim();
  if (!prompt) return;
  $("#imageOutput").textContent = "Generating...";
  try {
    const data = await api("/api/media/images/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, size: $("#imageSize").value, response_format: "b64_json" }),
    });
    renderMediaResult($("#imageOutput"), data);
  } catch (error) {
    $("#imageOutput").textContent = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([loadMedia(), loadUsage()]);
}

async function runSpeech(event) {
  event.preventDefault();
  const input = $("#speechInput").value.trim();
  if (!input) return;
  $("#speechOutput").textContent = "Generating...";
  try {
    const data = await api("/api/media/audio/speech", {
      method: "POST",
      body: JSON.stringify({ input, voice: $("#speechVoice").value.trim() || "alloy" }),
    });
    renderMediaResult($("#speechOutput"), data);
  } catch (error) {
    $("#speechOutput").textContent = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([loadMedia(), loadUsage()]);
}

async function runTranscription(event) {
  event.preventDefault();
  const audioBase64 = $("#transcriptionAudio").value.trim();
  if (!audioBase64) return;
  $("#transcriptionOutput").textContent = "Transcribing...";
  try {
    const data = await api("/api/media/audio/transcriptions", {
      method: "POST",
      body: JSON.stringify({ audioBase64, mime: $("#transcriptionMime").value.trim() || "audio/wav" }),
    });
    renderMediaResult($("#transcriptionOutput"), data);
  } catch (error) {
    $("#transcriptionOutput").textContent = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([loadMedia(), loadUsage()]);
}

async function runVideo(event) {
  event.preventDefault();
  const prompt = $("#videoPrompt").value.trim();
  if (!prompt) return;
  $("#videoOutput").textContent = "Generating...";
  try {
    const data = await api("/api/media/video/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, seconds: Number($("#videoSeconds").value || 4) }),
    });
    renderMediaResult($("#videoOutput"), data);
  } catch (error) {
    $("#videoOutput").textContent = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([loadMedia(), loadUsage()]);
}

async function indexDocument(event) {
  event.preventDefault();
  await api("/api/search/documents", {
    method: "POST",
    body: JSON.stringify({ title: $("#docTitle").value, body: $("#docBody").value }),
  });
  $("#docTitle").value = "";
  $("#docBody").value = "";
  await loadDocuments();
}

async function searchHf() {
  const q = $("#hfQuery").value.trim();
  if (!q) return;
  const data = await api(`/api/models/hf/search?q=${encodeURIComponent(q)}`);
  $("#hfResults").innerHTML = data.results
    .map(
      (model) => `
        <div>
          <strong>${model.id}</strong>
          <div class="meta">${model.downloads || 0} downloads · ${model.likes || 0} likes</div>
          <button data-repo="${model.id}" class="show-files">Files</button>
        </div>`,
    )
    .join("");
}

async function showHfFiles(button) {
  const repo = button.dataset.repo;
  const data = await api(`/api/models/hf/files?repo=${encodeURIComponent(repo)}`);
  button.parentElement.insertAdjacentHTML(
    "beforeend",
    data.files
      .slice(0, 8)
      .map(
        (file) => `
          <div class="meta">
            ${file.rfilename} ${file.size ? `· ${Math.round(file.size / 1024 / 1024)}MB` : ""}
            <button data-repo="${repo}" data-file="${file.rfilename}" class="download-file">Download</button>
          </div>`,
      )
      .join(""),
  );
}

async function downloadFile(button) {
  button.textContent = "Downloading";
  const data = await api("/api/models/download", {
    method: "POST",
    body: JSON.stringify({ repo: button.dataset.repo, filename: button.dataset.file }),
  });
  button.textContent = "Downloaded";
  console.log(data);
  await Promise.all([loadModels(), loadSetupActions(), loadRuntime(), loadLocalSupervisor()]);
}

async function setDefaultModel(button) {
  const modelId = button.dataset.modelId;
  if (!modelId) return;
  button.disabled = true;
  button.textContent = "Saving";
  state.settingsStatus = await api("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ defaultModelPreset: modelId }),
  });
  if (state.status) state.status.settings = state.settingsStatus.settings;
  applySettingsToUi();
  await Promise.all([loadModels(), loadReadiness(), loadSetupActions(), loadLaunchProfile(), loadLocalSupervisor()]);
}

async function installModel(button) {
  const original = button.textContent;
  button.textContent = "Installing";
  button.disabled = true;
  try {
    const data = await api("/api/models/install", {
      method: "POST",
      body: JSON.stringify({ modelPreset: button.dataset.modelId }),
    });
    button.textContent = "Installed";
    console.log(data);
  } catch (error) {
    button.textContent = "Install failed";
    alert(error instanceof Error ? error.message : String(error));
  } finally {
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  }
  await Promise.all([loadModels(), loadReadiness(), loadSetupActions(), loadRuntime(), loadLaunchProfile(), loadLocalSupervisor()]);
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.matches(".nav")) {
    document.querySelectorAll(".nav,.view").forEach((el) => el.classList.remove("active"));
    target.classList.add("active");
    $(`#${target.dataset.view}`).classList.add("active");
  }
  if (target.matches(".chat-item")) await openChat(target.dataset.chatId);
  if (target.matches(".show-files")) await showHfFiles(target);
  if (target.matches(".download-file")) await downloadFile(target);
  if (target.matches(".install-model")) await installModel(target);
  if (target.matches(".set-default-model")) await setDefaultModel(target);
  if (target.matches(".revoke-api-key")) {
    const revoked = state.apiKeys.find((key) => key.id === target.dataset.id);
    await api(`/api/api-keys/${target.dataset.id}`, { method: "DELETE", body: "{}" });
    if (revoked && (localStorage.getItem("nipuxApiKey") || "").startsWith(revoked.prefix.replace("...", ""))) {
      localStorage.removeItem("nipuxApiKey");
      $("#settingsApiKey").value = "";
    }
    await Promise.all([loadSettings(), loadApiKeys(), loadReadiness(), loadSetupActions(), loadLaunchProfile()]);
  }
  if (target.matches(".copy-command")) {
    const original = target.textContent;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is not available.");
      await navigator.clipboard.writeText(target.dataset.command || "");
      target.textContent = "Copied";
    } catch {
      target.textContent = "Copy failed";
    }
    setTimeout(() => {
      target.textContent = original;
    }, 1200);
  }
  if (target.matches(".permission-approve")) {
    await api(`/api/permissions/${target.dataset.id}/approve`, { method: "POST", body: "{}" });
    await Promise.all([loadPermissions(), loadBrowserActions()]);
  }
  if (target.matches(".permission-deny")) {
    await api(`/api/permissions/${target.dataset.id}/deny`, { method: "POST", body: "{}" });
    await Promise.all([loadPermissions(), loadBrowserActions()]);
  }
  if (target.matches(".memory-save")) {
    const card = target.closest(".list > div");
    await api(`/api/memories/${target.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        kind: card.querySelector(".memory-kind").value,
        importance: Number(card.querySelector(".memory-importance").value),
        summary: card.querySelector(".memory-summary").value,
        content: card.querySelector(".memory-edit-content").value,
      }),
    });
    await loadMemories($("#memoryQuery").value.trim());
  }
  if (target.matches(".memory-delete")) {
    await api(`/api/memories/${target.dataset.id}`, { method: "DELETE" });
    await loadMemories($("#memoryQuery").value.trim());
  }
  if (target.matches(".document-delete")) {
    await api(`/api/search/documents/${target.dataset.id}`, { method: "DELETE" });
    await loadDocuments();
  }
  if (target.matches(".chat-speak")) await playChatSpeech(target);
  if (target.matches("#voiceInput")) await toggleVoiceInput(target);
  if (target.matches(".browser-open")) {
    const id = target.dataset.id;
    try {
      await api(`/api/browsers/${id}/open`, { method: "POST", body: "{}" });
      delete state.browserErrors[id];
      await refreshBrowserScreenshot(id);
    } catch (error) {
      state.browserErrors[id] = error instanceof Error ? error.message : String(error);
      await loadAgents();
    }
  }
  if (target.matches(".browser-go")) {
    const id = target.dataset.id;
    const card = browserCard(target);
    const url = card.querySelector(".browser-url").value;
    try {
      await api(`/api/browsers/${id}/navigate`, { method: "POST", body: JSON.stringify({ url }) });
      delete state.browserErrors[id];
      await refreshBrowserScreenshot(id);
    } catch (error) {
      state.browserErrors[id] = error instanceof Error ? error.message : String(error);
      await loadAgents();
    }
  }
  if (target.matches(".browser-refresh")) await refreshBrowserScreenshot(target.dataset.id);
  if (target.matches(".browser-close")) {
    const id = target.dataset.id;
    await api(`/api/browsers/${id}/close`, { method: "POST", body: "{}" });
    delete state.browserShots[id];
    delete state.browserErrors[id];
    await Promise.all([loadAgents(), loadUsage()]);
  }
  if (target.matches(".browser-type")) {
    const id = target.dataset.id;
    const card = browserCard(target);
    const text = card.querySelector(".browser-text").value;
    await api(`/api/browsers/${id}/type`, { method: "POST", body: JSON.stringify({ text }) });
    card.querySelector(".browser-text").value = "";
    await refreshBrowserScreenshot(id);
  }
  if (target.matches(".browser-enter")) {
    const id = target.dataset.id;
    await api(`/api/browsers/${id}/key`, { method: "POST", body: JSON.stringify({ key: "Enter" }) });
    await refreshBrowserScreenshot(id);
  }
  if (target.matches(".browser-preview")) {
    const rect = target.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * target.naturalWidth);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * target.naturalHeight);
    await api(`/api/browsers/${target.dataset.id}/click`, { method: "POST", body: JSON.stringify({ x, y }) });
    await refreshBrowserScreenshot(target.dataset.id);
  }
});

$("#chatForm").addEventListener("submit", sendChat);
$("#agentForm").addEventListener("submit", runAgentForm);
$("#memoryForm").addEventListener("submit", saveMemory);
$("#memorySearch").addEventListener("click", () => loadMemories($("#memoryQuery").value.trim()));
$("#memoryCompact").addEventListener("click", async () => {
  if (!state.activeAgentId) return;
  await api(`/api/agents/${state.activeAgentId}/memories/compact`, {
    method: "POST",
    body: JSON.stringify({ maxSource: 30 }),
  });
  await loadMemories($("#memoryQuery").value.trim());
});
$("#searchForm").addEventListener("submit", runSearch);
$("#imageForm").addEventListener("submit", runImage);
$("#speechForm").addEventListener("submit", runSpeech);
$("#transcriptionForm").addEventListener("submit", runTranscription);
$("#videoForm").addEventListener("submit", runVideo);
$("#documentForm").addEventListener("submit", indexDocument);
$("#indexFilesButton").addEventListener("click", indexSelectedFiles);
$("#clearFileSelection").addEventListener("click", clearSelectedFiles);
$("#indexPathButton").addEventListener("click", async () => {
  const path = $("#indexPath").value.trim();
  if (!path) return;
  $("#indexOutput").textContent = "Indexing...";
  try {
    const data = await api("/api/search/index-path", {
      method: "POST",
      body: JSON.stringify({ path, maxFiles: 500, maxBytes: 1024 * 1024, recursive: true }),
    });
    $("#indexOutput").textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    $("#indexOutput").textContent = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([loadDocuments(), loadUsage()]);
});
$("#hfSearch").addEventListener("click", searchHf);
$("#refreshModels").addEventListener("click", loadModels);
$("#refreshMedia").addEventListener("click", loadMedia);
$("#applyMediaDefaults").addEventListener("click", async () => {
  const data = await api("/api/media/runtimes/defaults", { method: "POST", body: JSON.stringify({}) });
  state.settingsStatus = { settings: data.settings, env: state.settingsStatus?.env || null };
  if (state.status) state.status.settings = data.settings;
  applySettingsToUi();
  await Promise.all([loadMedia(), loadReadiness(), loadSetupActions(), loadLocalSupervisor()]);
});
$("#refreshUsage").addEventListener("click", async () => {
  await Promise.all([loadUsage(), loadDiagnostics()]);
});
$("#copyDiagnostics").addEventListener("click", async () => {
  const button = $("#copyDiagnostics");
  const original = button.textContent;
  try {
    if (!state.diagnostics) await loadDiagnostics();
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard is not available.");
    await navigator.clipboard.writeText(JSON.stringify(state.diagnostics, null, 2));
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1200);
});
$("#refreshReadiness").addEventListener("click", async () => {
  await Promise.all([loadReadiness(), loadSetupActions(), loadLaunchProfile(), loadLocalSupervisor()]);
});
$("#writeLaunchProfile").addEventListener("click", async () => {
  const result = await api("/api/launch/profile/write", { method: "POST", body: "{}" });
  state.launchProfile = result.profile;
  await Promise.all([loadLaunchProfile(), loadLocalSupervisor()]);
});
$("#startRuntime").addEventListener("click", async () => {
  $("#runtimeOutput").textContent = "Starting...";
  try {
    const data = await api("/api/runtime/start", {
      method: "POST",
      body: JSON.stringify({ modelPreset: $("#presetSelect").value }),
    });
    $("#runtimeOutput").textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    $("#runtimeOutput").textContent = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([loadRuntime(), loadUsage(), loadReadiness(), loadSetupActions()]);
});
$("#stopRuntime").addEventListener("click", async () => {
  const data = await api("/api/runtime/stop", { method: "POST", body: "{}" });
  $("#runtimeOutput").textContent = JSON.stringify(data, null, 2);
  await Promise.all([loadRuntime(), loadUsage(), loadReadiness(), loadSetupActions()]);
});
$("#testRuntime").addEventListener("click", async () => {
  const prompt = $("#runtimePrompt").value.trim();
  if (!prompt) return;
  $("#runtimeOutput").textContent = "Testing...";
  try {
    const data = await api("/api/runtime/test", {
      method: "POST",
      body: JSON.stringify({ prompt, modelPreset: $("#presetSelect").value }),
    });
    $("#runtimeOutput").textContent = data.output;
  } catch (error) {
    $("#runtimeOutput").textContent = error instanceof Error ? error.message : String(error);
  }
  await loadUsage();
});
$("#saveSettings").addEventListener("click", async () => {
  $("#settingsStatus").textContent = "Saving...";
  try {
    await saveSettings();
  } catch (error) {
    $("#settingsStatus").textContent = error instanceof Error ? error.message : String(error);
  }
});
$("#createServerApiKey").addEventListener("click", async () => {
  const button = $("#createServerApiKey");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Creating";
  try {
    const data = await api("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({ label: `Local API key ${new Date().toISOString().slice(0, 10)}` }),
    });
    localStorage.setItem("nipuxApiKey", data.key);
    $("#settingsApiKey").value = data.key;
    $("#serverApiKeyOutput").textContent = `New server key, shown once:\n${data.key}`;
    await Promise.all([loadSettings(), loadApiKeys(), loadReadiness(), loadSetupActions(), loadLaunchProfile()]);
    button.textContent = "Created";
  } catch (error) {
    $("#serverApiKeyOutput").textContent = error instanceof Error ? error.message : String(error);
    button.textContent = "Create failed";
  } finally {
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  }
});
$("#clearApiKey").addEventListener("click", () => {
  localStorage.removeItem("nipuxApiKey");
  $("#settingsApiKey").value = "";
  applySettingsToUi();
});
$("#newChat").addEventListener("click", createNewChat);
$("#createBrowser").addEventListener("click", async () => {
  await api("/api/browsers", { method: "POST", body: JSON.stringify({ label: "Agent Browser", agentId: state.activeAgentId }) });
  await loadAgents();
});

await loadStatus();
await loadSettings();
await Promise.all([loadModels(), loadRuntime(), loadReadiness(), loadSetupActions(), loadLaunchProfile(), loadLocalSupervisor(), loadUsage(), loadDiagnostics(), loadApiKeys(), loadAgents(), loadDocuments(), loadMedia()]);
await loadChats();
if (state.chats[0]) await openChat(state.chats[0].id);
else await createNewChat();
