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
};

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

function addMessage(role, content = "") {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
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
  $("#presetSelect").value = hw.recommendedPreset || "balanced";
  setStatus(state.status.fakeLlm ? "dev mode" : `${hw.accelerator} ${hw.totalRamGb}GB`);
  $("#devStatus").textContent = JSON.stringify(state.status, null, 2);
}

async function loadModels() {
  const data = await api("/api/models");
  state.models = data.models;
  $("#modelList").innerHTML = state.models
    .map(
      (model) => `
      <div class="model">
        <strong>${model.label}</strong>
        <div class="meta">${model.family} ${model.parametersB}B ${model.quant}</div>
        <div class="meta">${model.repo}</div>
        <div class="meta">State: ${model.state} · RAM: ${model.estimatedRamGb}GB</div>
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
                ${["fact", "profile", "procedure", "task"]
                  .map((kind) => `<option value="${kind}" ${kind === memory.kind ? "selected" : ""}>${kind}</option>`)
                  .join("")}
              </select>
              <input class="memory-importance" type="number" min="1" max="5" value="${h(memory.importance)}" />
            </div>
            <textarea class="memory-edit-content" rows="3">${h(memory.content)}</textarea>
            <div class="meta">${h(memory.createdAt)}</div>
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
  await api(`/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify({ modelPreset: $("#presetSelect").value }),
  });
  await api(`/api/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ role: "user", content }),
  });
  state.messages.push({ role: "user", content });
  addMessage("user", content);
  const assistant = addMessage("assistant", "");
  const model = $("#presetSelect").value;

  const res = await fetchWithAuth("/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages: state.messages }),
  });

  if (!res.ok || !res.body) {
    assistant.textContent = await res.text();
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
        assistant.textContent = full;
      } catch {
        // Ignore malformed SSE fragments from alternate backends.
      }
    }
  }
  state.messages.push({ role: "assistant", content: full });
  if (full) {
    await api(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "assistant", content: full }),
    });
  }
  await Promise.all([loadUsage(), loadChats()]);
}

async function runAgentForm(event) {
  event.preventDefault();
  const input = $("#agentInput").value.trim();
  if (!input) return;
  $("#agentOutput").textContent = "Running...";
  const data = await api("/api/agents/run", {
    method: "POST",
    body: JSON.stringify({ input, modelPreset: $("#presetSelect").value }),
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
  await loadModels();
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
  if (target.matches(".memory-save")) {
    const card = target.closest(".list > div");
    await api(`/api/memories/${target.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        kind: card.querySelector(".memory-kind").value,
        importance: Number(card.querySelector(".memory-importance").value),
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
$("#searchForm").addEventListener("submit", runSearch);
$("#documentForm").addEventListener("submit", indexDocument);
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
$("#refreshUsage").addEventListener("click", loadUsage);
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
  await Promise.all([loadRuntime(), loadUsage()]);
});
$("#stopRuntime").addEventListener("click", async () => {
  const data = await api("/api/runtime/stop", { method: "POST", body: "{}" });
  $("#runtimeOutput").textContent = JSON.stringify(data, null, 2);
  await Promise.all([loadRuntime(), loadUsage()]);
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
$("#newChat").addEventListener("click", createNewChat);
$("#createBrowser").addEventListener("click", async () => {
  await api("/api/browsers", { method: "POST", body: JSON.stringify({ label: "Agent Browser" }) });
  await loadAgents();
});

await loadStatus();
await Promise.all([loadModels(), loadRuntime(), loadUsage(), loadAgents(), loadDocuments()]);
await loadChats();
if (state.chats[0]) await openChat(state.chats[0].id);
else await createNewChat();
