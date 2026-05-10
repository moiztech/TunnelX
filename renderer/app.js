"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  modeHost: $("modeHost"),
  modeJoin: $("modeJoin"),
  joinOnly: $("joinOnlyFields"),
  displayName: $("displayName"),
  hostAddress: $("hostAddress"),
  roomId: $("roomId"),
  btnPrimary: $("btnPrimary"),
  btnLeave: $("btnLeave"),
  statusPill: $("statusPill"),
  connState: $("connState"),
  pingMs: $("pingMs"),
  memberList: $("memberList"),
  playersEmpty: $("playersEmpty"),
  toast: $("toast"),
  appVersion: $("appVersion"),
};

const LS_NAME = "lb_display_name";
const LS_HOST = "lb_host_address";
const LS_ROOM = "lb_room";
const LS_MODE = "lb_mode";

const state = {
  mode: "host",
  wsUrl: "",
  ws: null,
  peerId: null,
  roomId: null,
  relayPort: null,
  serverHost: "",
  reconnectTimer: null,
  pingTimer: null,
  lastSession: null,
  intentionalClose: false,
  toastTimer: null,
};

function loadPrefs() {
  try {
    const n = localStorage.getItem(LS_NAME);
    const h = localStorage.getItem(LS_HOST);
    const r = localStorage.getItem(LS_ROOM);
    const m = localStorage.getItem(LS_MODE);
    if (n) els.displayName.value = n;
    if (h) els.hostAddress.value = h;
    if (r) els.roomId.value = r;
    if (m === "join" || m === "host") setMode(m, false);
  } catch (_) {}
}

function savePrefs() {
  try {
    localStorage.setItem(LS_NAME, els.displayName.value.trim());
    localStorage.setItem(LS_HOST, els.hostAddress.value.trim());
    localStorage.setItem(LS_ROOM, els.roomId.value.trim());
    localStorage.setItem(LS_MODE, state.mode);
  } catch (_) {}
}

function toast(msg, kind) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.remove("error", "info");
  if (kind) els.toast.classList.add(kind);
  els.toast.hidden = false;
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function setMode(mode, save) {
  state.mode = mode;
  const isJoin = mode === "join";
  els.modeHost.classList.toggle("active", !isJoin);
  els.modeHost.setAttribute("aria-selected", (!isJoin).toString());
  els.modeJoin.classList.toggle("active", isJoin);
  els.modeJoin.setAttribute("aria-selected", isJoin.toString());
  els.joinOnly.classList.toggle("hidden", !isJoin);
  els.btnPrimary.textContent = isJoin ? "Join lobby" : "Host lobby";
  if (save) savePrefs();
}

function toWsUrl(input) {
  const s = input.trim();
  if (!s) return null;
  if (s.startsWith("ws://") || s.startsWith("wss://")) {
    try {
      const u = new URL(s);
      if (!u.pathname || u.pathname === "/") u.pathname = "/ws";
      return u.href;
    } catch {
      return null;
    }
  }
  const host = s.replace(/^\s+|\s+$/g, "").replace(/^\/+/, "");
  if (!host) return null;
  return `ws://${host}:8787/ws`;
}

function parseWsHost(wsUrl) {
  try {
    return new URL(wsUrl).hostname;
  } catch {
    return "";
  }
}

function setStatus(text, variant) {
  els.connState.textContent = text;
  els.statusPill.classList.remove("ok", "warn", "bad");
  if (variant) els.statusPill.classList.add(variant);
}

function stopPing() {
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
}

function startPing() {
  stopPing();
  state.pingTimer = setInterval(() => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ action: "ping", t: Date.now() }));
  }, 2000);
}

function clearReconnectTimer() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (state.intentionalClose || !state.lastSession) return;
  if (state.reconnectTimer) return;
  const attempt = state.lastSession.attempts || 0;
  const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
  state.lastSession.attempts = attempt + 1;
  setStatus("Reconnecting…", "warn");
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect(
      state.lastSession.mode,
      state.lastSession.room,
      state.lastSession.name,
      state.lastSession.wsUrl
    );
  }, delay);
}

function resetUiDisconnected() {
  els.btnLeave.disabled = true;
  els.btnPrimary.disabled = false;
  els.modeHost.disabled = false;
  els.modeJoin.disabled = false;
  els.displayName.disabled = false;
  els.hostAddress.disabled = false;
  els.roomId.disabled = false;
  els.memberList.innerHTML = "";
  els.playersEmpty.classList.remove("hidden");
  els.pingMs.textContent = "—";
  setStatus("Not connected", "");
  state.peerId = null;
  state.roomId = null;
}

function renderMembers(members, selfId) {
  els.memberList.innerHTML = "";
  if (!members.length) {
    els.playersEmpty.classList.remove("hidden");
    return;
  }
  els.playersEmpty.classList.add("hidden");
  for (const m of members) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = m.name;
    li.appendChild(name);
    if (m.id === selfId) {
      const badge = document.createElement("span");
      badge.className = "you-badge";
      badge.textContent = "You";
      li.appendChild(badge);
    }
    els.memberList.appendChild(li);
  }
}

async function startBridgeSession(data) {
  if (!window.lanbridgeSession) return;
  try {
    await window.lanbridgeSession.start({
      relayPort: data.relayUdpPort,
      serverHost: state.serverHost || parseWsHost(state.wsUrl),
      roomId: data.roomId,
      peerId: data.peerId,
      virtualIp: data.virtualIp,
    });
  } catch (_) {}
}

async function stopBridgeSession() {
  if (window.lanbridgeSession) {
    try {
      await window.lanbridgeSession.stop();
    } catch (_) {}
  }
}

async function applyWelcome(data) {
  state.peerId = data.peerId;
  state.roomId = data.roomId;
  state.relayPort = data.relayUdpPort;
  state.serverHost = parseWsHost(state.wsUrl);
  renderMembers(data.members || [], data.peerId);
  els.btnLeave.disabled = false;
  els.btnPrimary.disabled = true;
  els.modeHost.disabled = true;
  els.modeJoin.disabled = true;
  els.displayName.disabled = true;
  els.hostAddress.disabled = true;
  els.roomId.disabled = true;
  if (state.lastSession) state.lastSession.attempts = 0;
  setStatus("In lobby", "ok");
  await startBridgeSession(data);
}

function friendlyServerError(msg) {
  if (!msg) return "Something went wrong.";
  if (msg.includes("Room already exists"))
    return "That room name is already in use. Pick another or join it.";
  if (msg.includes("Room not found"))
    return "Room not found. Check the name and host address.";
  if (msg.includes("Invalid room")) return "That room name isn’t valid.";
  return msg;
}

function connect(mode, room, name, wsUrl) {
  state.intentionalClose = false;
  state.wsUrl = wsUrl;

  if (state.ws) {
    try {
      state.ws.close();
    } catch (_) {}
    state.ws = null;
  }

  setStatus("Connecting…", "warn");
  els.pingMs.textContent = "—";

  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    setStatus("Connected", "ok");
    if (
      !state.lastSession ||
      state.lastSession.room !== room ||
      state.lastSession.wsUrl !== wsUrl
    ) {
      state.lastSession = { mode, room, name, attempts: 0, wsUrl };
    }
    ws.send(
      JSON.stringify({
        action: mode === "create" ? "create" : "join",
        room,
        name,
      })
    );
    startPing();
  };

  ws.onmessage = (ev) => {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (data.type === "error") {
      toast(friendlyServerError(data.message), "error");
      setStatus("Couldn’t join", "bad");
      clearReconnectTimer();
      state.lastSession = null;
      try {
        ws.close();
      } catch (_) {}
      resetUiDisconnected();
      return;
    }
    if (data.type === "pong" && data.t) {
      els.pingMs.textContent = `${Date.now() - data.t} ms`;
      return;
    }
    if (data.type === "welcome") {
      applyWelcome(data);
      return;
    }
    if (data.type === "room_state") {
      state.roomId = data.roomId;
      state.relayPort = data.relayUdpPort;
      renderMembers(data.members || [], state.peerId);
    }
  };

  ws.onclose = () => {
    stopPing();
    stopBridgeSession();
    state.ws = null;
    if (state.intentionalClose) {
      setStatus("Left lobby", "");
      resetUiDisconnected();
      return;
    }
    setStatus("Connection lost", "bad");
    scheduleReconnect();
  };

  ws.onerror = () => {
    setStatus("No connection", "bad");
  };
}

els.modeHost.addEventListener("click", () => setMode("host", true));
els.modeJoin.addEventListener("click", () => setMode("join", true));

els.btnPrimary.addEventListener("click", async () => {
  const room = els.roomId.value.trim();
  const name = els.displayName.value.trim() || "Player";
  if (!room) {
    toast("Enter a room name first.", "error");
    return;
  }
  savePrefs();
  clearReconnectTimer();

  if (state.mode === "host") {
    if (window.lanbridgeHost) {
      const r = await window.lanbridgeHost.ensureServer();
      if (!r.ok) {
        toast(r.message || "Could not start the lobby on this PC.", "error");
        return;
      }
      if (r.note === "in_use") {
        toast("Using the lobby server already running on this computer.", "info");
      }
    }
    const wsUrl = "ws://127.0.0.1:8787/ws";
    state.lastSession = { mode: "create", room, name, attempts: 0, wsUrl };
    connect("create", room, name, wsUrl);
  } else {
    const hostAddr = els.hostAddress.value.trim();
    if (!hostAddr) {
      toast("Enter your friend’s PC address to join.", "error");
      return;
    }
    const wsUrl = toWsUrl(hostAddr);
    if (!wsUrl) {
      toast("That address doesn’t look right. Try something like 192.168.1.5", "error");
      return;
    }
    state.lastSession = { mode: "join", room, name, attempts: 0, wsUrl };
    connect("join", room, name, wsUrl);
  }
});

els.btnLeave.addEventListener("click", () => {
  state.intentionalClose = true;
  state.lastSession = null;
  clearReconnectTimer();
  stopPing();
  stopBridgeSession();
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ action: "leave" }));
    } catch (_) {}
    state.ws.close();
  }
  state.ws = null;
  resetUiDisconnected();
});

loadPrefs();

if (window.lanbridge && window.lanbridge.appVersion) {
  window.lanbridge.appVersion().then((v) => {
    if (v) els.appVersion.textContent = `TunnelX v${v} · E11 Labs`;
  });
}
