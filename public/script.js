const $ = (id) => document.getElementById(id);

const state = {
  sent: 0,
  allowed: 0,
  rejected: 0,
  history: [],
  limit: 5,
  windowSeconds: 10,
  cooldownUntil: 0,
  cooldownTimer: null,
  busy: false
};

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderStats() {
  $("totalSent").textContent = state.sent;
  $("allowedCount").textContent = state.allowed;
  $("rejectedCount").textContent = state.rejected;
}

function renderHistory() {
  const body = $("historyBody");
  if (!state.history.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">No requests yet. Send a request to begin testing.</td></tr>';
    return;
  }
  body.innerHTML = state.history.map((item) => {
    const badge = item.status === 200 ? "status-ok" : item.status === 429 ? "status-rejected" : "status-error";
    const responseClass = item.status === 429 ? "response-rejected" : "response-success";
    return `<tr>
      <td>${item.number}</td><td>${item.time}</td>
      <td><span class="status-badge ${badge}">${item.status} ${item.status === 200 ? "OK" : ""}</span></td>
      <td class="${responseClass}">${escapeHtml(item.message)}</td>
      <td>${item.remaining} / ${state.limit}</td><td>${item.cooldown > 0 ? `${item.cooldown}s` : "—"}</td>
    </tr>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function setConnection(online, text) {
  $("connectionDot").classList.toggle("offline", !online);
  $("connectionText").textContent = text;
}

function showError(message) {
  $("errorBanner").classList.remove("hidden");
  $("errorText").textContent = message;
}

function hideError() {
  $("errorBanner").classList.add("hidden");
}

function updateCooldown(seconds, active = true) {
  const duration = Math.max(0, Number(seconds) || 0);
  state.cooldownUntil = active && duration > 0 ? Date.now() + duration * 1000 : 0;
  if (state.cooldownTimer) clearInterval(state.cooldownTimer);
  state.cooldownTimer = null;

  const tick = () => {
    const remaining = Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
    $("cooldownValue").textContent = remaining > 0 ? `${remaining}s` : "—";
    $("cooldownText").textContent = `${remaining}s remaining`;
    $("cooldownProgress").style.width = `${state.windowSeconds ? Math.min(100, remaining / state.windowSeconds * 100) : 0}%`;
    $("limitBanner").classList.toggle("hidden", remaining <= 0);
    if (remaining <= 0 && state.cooldownTimer) {
      clearInterval(state.cooldownTimer);
      state.cooldownTimer = null;
      $("noticeTitle").textContent = "Ready to test";
      $("noticeText").textContent = `Your quota window has reset. You can send up to ${state.limit} requests again.`;
    }
  };
  tick();
  if (state.cooldownUntil > Date.now()) state.cooldownTimer = setInterval(tick, 250);
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Status endpoint returned HTTP " + response.status);
    const status = await response.json();
    if (status.cooldownActive && status.retryAfter > 0) {
      // Do not keep resetting the local countdown if it is already tracking the same window.
      const target = Date.now() + status.retryAfter * 1000;
      if (!state.cooldownUntil || Math.abs(state.cooldownUntil - target) > 1200) updateCooldown(status.retryAfter, true);
    } else if (state.cooldownUntil && Date.now() >= state.cooldownUntil) {
      updateCooldown(0, false);
    }
    setConnection(true, "Server Connected");
    hideError();
    $("clientId").textContent = "Detected from your connection";
  } catch (error) {
    setConnection(false, "Server Offline");
    showError("Could not read API status. Make sure the Node server and Redis are running.");
  }
}

function addHistory(status, message, remaining, cooldown) {
  state.sent++;
  if (status === 200) state.allowed++;
  else state.rejected++;
  state.history.unshift({
    number: state.sent,
    time: formatTime(),
    status,
    message,
    remaining: Math.max(0, Number(remaining) || 0),
    cooldown: Math.max(0, Number(cooldown) || 0)
  });
  // Most recent 100 entries are retained in the UI.
  state.history = state.history.slice(0, 100);
  renderStats();
  renderHistory();
}

async function sendOneRequest() {
  try {
    const response = await fetch("/api/test", { method: "GET", cache: "no-store" });
    const data = await response.json();
    const remaining = data.remaining ?? response.headers.get("RateLimit-Remaining") ?? 0;
    const cooldown = data.retryAfter ?? 0;
    addHistory(response.status, response.status === 200 ? "Request successful" : (data.message || "Request failed"), remaining, cooldown);

    if (response.status === 429) {
      updateCooldown(cooldown, true);
      $("noticeTitle").textContent = "Rate limit reached";
      $("noticeText").textContent = `You've reached ${state.limit} requests in ${state.windowSeconds} seconds. Wait for the cooldown to finish.`;
    } else if (response.status === 200) {
      $("noticeTitle").textContent = "Request completed";
      $("noticeText").textContent = `${data.remaining} request${data.remaining === 1 ? "" : "s"} remaining in the current window.`;
      if (data.remaining === 0 && data.resetAfter > 0) updateCooldown(data.resetAfter, true);
    } else {
      showError(data.message || `API returned HTTP ${response.status}`);
    }
    return response.status;
  } catch (error) {
    addHistory(0, "Network / server error", 0, 0);
    showError("Unable to contact the API. Check that the server is running and Redis is connected.");
    setConnection(false, "Server Offline");
    return 0;
  }
}

async function sendBatch(count) {
  if (state.busy) return;
  state.busy = true;
  $("sendBatch").disabled = true;
  $("sendOne").disabled = true;
  $("sendBatch").innerHTML = "<span>…</span> Sending Requests";
  hideError();
  try {
    for (let i = 0; i < count; i++) {
      await sendOneRequest();
      // A tiny pause keeps the table readable and still tests the limit quickly.
      if (i < count - 1) await new Promise((resolve) => setTimeout(resolve, 90));
    }
  } finally {
    state.busy = false;
    $("sendBatch").disabled = false;
    $("sendOne").disabled = false;
    $("sendBatch").innerHTML = "<span>▷</span> Send Requests";
    refreshStatus();
  }
}

async function initialize() {
  $("requestCount").addEventListener("input", (event) => {
    $("requestCountValue").textContent = event.target.value;
  });
  $("sendBatch").addEventListener("click", () => sendBatch(Number($("requestCount").value)));
  $("sendOne").addEventListener("click", () => sendBatch(1));
  $("clearHistory").addEventListener("click", () => {
    state.history = [];
    renderHistory();
  });
  $("resetStats").addEventListener("click", () => {
    // This resets only browser display counters, not Redis quota state.
    state.sent = 0; state.allowed = 0; state.rejected = 0; state.history = [];
    renderStats(); renderHistory();
    refreshStatus();
  });
  $("copyEndpoint").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/api/test`);
      $("copyEndpoint").textContent = "✓";
      setTimeout(() => $("copyEndpoint").textContent = "▢", 1000);
    } catch {
      $("copyEndpoint").textContent = "Copy URL in address bar";
    }
  });

  try {
    const [healthResponse, configResponse] = await Promise.all([
      fetch("/api/health", { cache: "no-store" }),
      fetch("/api/config", { cache: "no-store" })
    ]);
    if (!healthResponse.ok || !configResponse.ok) throw new Error("API initialization failed");
    const health = await healthResponse.json();
    const config = await configResponse.json();
    state.limit = config.limit;
    state.windowSeconds = config.windowSeconds;
    $("configLimit").textContent = `${config.limit} requests`;
    $("configWindow").textContent = `${config.windowSeconds} seconds`;
    $("noticeText").textContent = `Each client IP can make ${config.limit} requests per ${config.windowSeconds}-second window.`;
    setConnection(health.redis === "connected", health.redis === "connected" ? "Server Connected" : "Redis Disconnected");
    if (health.redis !== "connected") showError("Node is running but Redis is disconnected.");
  } catch {
    setConnection(false, "Server Offline");
    showError("Start Redis and the Node server, then refresh this page.");
  }
  await refreshStatus();
  renderStats();
  renderHistory();
  setInterval(refreshStatus, 2000);
}

initialize();
