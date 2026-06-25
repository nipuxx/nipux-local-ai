const state = {
  status: null,
  models: [],
  messages: [],
};

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
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
          <div>
            <strong>${session.label}</strong>
            <div class="meta">${session.status} · ${session.url || "about:blank"}</div>
          </div>`,
      )
      .join("") || `<div class="meta">No browser sessions yet.</div>`;
}

async function sendChat(event) {
  event.preventDefault();
  const input = $("#chatInput");
  const content = input.value.trim();
  if (!content) return;
  input.value = "";
  state.messages.push({ role: "user", content });
  addMessage("user", content);
  const assistant = addMessage("assistant", "");
  const model = $("#presetSelect").value;

  const res = await fetch("/v1/chat/completions", {
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
  await loadUsage();
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
  if (target.matches(".show-files")) await showHfFiles(target);
  if (target.matches(".download-file")) await downloadFile(target);
});

$("#chatForm").addEventListener("submit", sendChat);
$("#agentForm").addEventListener("submit", runAgentForm);
$("#searchForm").addEventListener("submit", runSearch);
$("#documentForm").addEventListener("submit", indexDocument);
$("#hfSearch").addEventListener("click", searchHf);
$("#refreshModels").addEventListener("click", loadModels);
$("#refreshUsage").addEventListener("click", loadUsage);
$("#newChat").addEventListener("click", () => {
  state.messages = [];
  $("#messages").innerHTML = "";
});
$("#createBrowser").addEventListener("click", async () => {
  await api("/api/browsers", { method: "POST", body: JSON.stringify({ label: "Agent Browser" }) });
  await loadAgents();
});

await Promise.all([loadStatus(), loadModels(), loadUsage(), loadAgents()]);
addMessage("assistant", "Local chat is ready. Use dev mode now, or start llama.cpp and run the same UI against your model.");
