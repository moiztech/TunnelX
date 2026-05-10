"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  modeHost: $("modeHost"),
  modeJoin: $("modeJoin"),
  joinOnly: $("joinOnlyFields"),
  displayName: $("displayName"),
  hostAddress: $("hostAddress"),
  roomId: $("roomId"),
  roomHintHost: $("roomHintHost"),
  roomHintJoin: $("roomHintJoin"),
  btnPrimary: $("btnPrimary"),
  btnLeave: $("btnLeave"),
  sessionCard: $("sessionCard"),
  sessionRoleHint: $("sessionRoleHint"),
  displayHostAddress: $("displayHostAddress"),
  displayRoomName: $("displayRoomName"),
  displayVirtualIp: $("displayVirtualIp"),
  displayTunnelStatus: $("displayTunnelStatus"),
  hostShareExplain: $("hostShareExplain"),
  joinerHostExplain: $("joinerHostExplain"),
  btnCopyInvite: $("btnCopyInvite"),
  statusPill: $("statusPill"),
  connState: $("connState"),
  pingMs: $("pingMs"),
  peerCountLine: $("peerCountLine"),
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
  role: null,
  roomDisplayName: "",
  hostShareIp: "",
  joinHostAddressRaw: "",
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
  els.roomHintHost.classList.toggle("hidden", isJoin);
  els.roomHintJoin.classList.toggle("hidden", !isJoin);
  els.btnPrimary.textContent = isJoin ? "Join lobby" : "Start hosting";
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

function setTunnelStatus(text, tone) {
  els.displayTunnelStatus.textContent = text;
  els.displayTunnelStatus.classList.remove("tunnel-ok", "tunnel-warn", "tunnel-bad");
  if (tone) els.displayTunnelStatus.classList.add(tone);
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
  setTunnelStatus("Reconnecting — hang tight", "tunnel-warn");
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

function hideSessionCard() {
  els.sessionCard.classList.add("hidden");
  els.displayHostAddress.textContent = "—";
  els.displayRoomName.textContent = "—";
  els.displayVirtualIp.textContent = "—";
  setTunnelStatus("—", "");
  els.hostShareExplain.classList.add("hidden");
  els.joinerHostExplain.classList.add("hidden");
  els.btnCopyInvite.classList.add("hidden");
  state.role = null;
  state.roomDisplayName = "";
  state.hostShareIp = "";
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
  els.peerCountLine.classList.add("hidden");
  els.pingMs.textContent = "—";
  setStatus("Not connected", "");
  hideSessionCard();
  state.peerId = null;
  state.roomId = null;
}

function updatePeerLine(count) {
  if (count <= 0) {
    els.peerCountLine.classList.add("hidden");
    return;
  }
  const word = count === 1 ? "player" : "players";
  els.peerCountLine.textContent = `${count} ${word} in this room`;
  els.peerCountLine.classList.remove("hidden");
}

function renderMembers(members, selfId) {
  els.memberList.innerHTML = "";
  updatePeerLine(members.length);
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

function buildInviteMessage() {
  const room = state.roomDisplayName || els.roomId.value.trim() || "(room name)";
  const addr =
    state.hostShareIp ||
    els.displayHostAddress.textContent.trim() ||
    "(your host address)";
  return `Let's play together with TunnelX (E11 Labs)

1) Open TunnelX and choose "I'm joining".
2) Host address: ${addr}
3) Room name: ${room}
4) Open the game and use LAN / local network multiplayer.

See you there!`;
}

async function copyInvite() {
  const text = buildInviteMessage();
  try {
    await navigator.clipboard.writeText(text);
    toast("Invite copied — paste it in Discord, WhatsApp, or any chat.", "info");
  } catch {
    toast("Could not copy automatically. Select the text in the lobby details and copy manually.", "error");
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
  state.role = data.role || null;
  state.roomDisplayName = data.room || "";

  els.sessionCard.classList.remove("hidden");
  els.displayRoomName.textContent = data.room || "—";
  els.displayVirtualIp.textContent = data.virtualIp || "—";
  setTunnelStatus("Ready — you’re linked to the lobby", "tunnel-ok");

  const isHost = data.role === "host";
  if (isHost) {
    els.sessionRoleHint.textContent =
      "Send the invite below to your friends. They only need two things: your Host address and this room name.";
    els.hostShareExplain.classList.remove("hidden");
    els.joinerHostExplain.classList.add("hidden");
    els.btnCopyInvite.classList.remove("hidden");

    let ip = "";
    if (window.lanbridge && window.lanbridge.getHostNetworkInfo) {
      try {
        const net = await window.lanbridge.getHostNetworkInfo();
        ip = net && net.primary ? net.primary : "";
      } catch (_) {}
    }
    if (!ip) {
      ip = "Could not detect automatically";
      els.displayHostAddress.textContent = ip;
      state.hostShareIp = "";
      els.btnCopyInvite.disabled = false;
      toast(
        "We couldn’t detect your Wi‑Fi address. If friends can’t join, search the web for “find my local IP on Windows” or ask your friend for help.",
        "info"
      );
    } else {
      els.displayHostAddress.textContent = ip;
      state.hostShareIp = ip;
      els.btnCopyInvite.disabled = false;
    }
  } else {
    els.sessionRoleHint.textContent =
      "You’re in your friend’s lobby. Everyone with the same room should see each other in-game.";
    els.hostShareExplain.classList.add("hidden");
    els.joinerHostExplain.classList.remove("hidden");
    els.btnCopyInvite.classList.add("hidden");

    const hostShown =
      state.joinHostAddressRaw.trim() || parseWsHost(state.wsUrl) || "—";
    els.displayHostAddress.textContent = hostShown;
    state.hostShareIp = hostShown;
  }

  renderMembers(data.members || [], data.peerId);
  els.btnLeave.disabled = false;
  els.btnPrimary.disabled = true;
  els.modeHost.disabled = true;
  els.modeJoin.disabled = true;
  els.displayName.disabled = true;
  els.hostAddress.disabled = true;
  els.roomId.disabled = true;
  if (state.lastSession) state.lastSession.attempts = 0;
  setStatus("In lobby — all good", "ok");
  await startBridgeSession(data);
}

function friendlyServerError(msg) {
  if (!msg) return "Something went wrong.";
  if (msg.includes("Room already exists"))
    return "That room name is already in use on this computer. Pick a different name, or join that room instead.";
  if (msg.includes("Room not found"))
    return "We couldn’t find that room. Double-check the room name and host address with your friend.";
  if (msg.includes("Invalid room")) return "That room name isn’t valid. Try letters and numbers only.";
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

  setStatus("Connecting to lobby…", "warn");
  setTunnelStatus("Connecting…", "tunnel-warn");
  els.pingMs.textContent = "—";

  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    setStatus("Almost there…", "warn");
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
      setStatus("Couldn’t connect", "bad");
      setTunnelStatus("Not connected", "tunnel-bad");
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
      void applyWelcome(data);
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
      setTunnelStatus("Left the lobby", "");
      resetUiDisconnected();
      return;
    }
    setStatus("Connection lost", "bad");
    setTunnelStatus("Connection lost", "tunnel-bad");
    scheduleReconnect();
  };

  ws.onerror = () => {
    setStatus("No connection", "bad");
    setTunnelStatus("Couldn’t reach the host", "tunnel-bad");
  };
}

els.modeHost.addEventListener("click", () => setMode("host", true));
els.modeJoin.addEventListener("click", () => setMode("join", true));

els.btnCopyInvite.addEventListener("click", () => {
  void copyInvite();
});

els.btnPrimary.addEventListener("click", async () => {
  const room = els.roomId.value.trim();
  const name = els.displayName.value.trim() || "Player";
  if (!room) {
    toast("Choose a room name first — keep it simple, like “friday-race”.", "error");
    return;
  }
  savePrefs();
  clearReconnectTimer();

  if (state.mode === "host") {
    if (window.lanbridgeHost) {
      const r = await window.lanbridgeHost.ensureServer();
      if (!r.ok) {
        toast(
          r.message ||
            "TunnelX couldn’t start the lobby on this PC. Another app may be using the same connection ports.",
          "error"
        );
        return;
      }
      if (r.note === "in_use") {
        toast(
          "Another TunnelX (or server) is already using this PC’s lobby ports — that’s OK, you can still host.",
          "info"
        );
      }
    }
    const wsUrl = "ws://127.0.0.1:8787/ws";
    state.joinHostAddressRaw = "";
    state.lastSession = { mode: "create", room, name, attempts: 0, wsUrl };
    connect("create", room, name, wsUrl);
  } else {
    const hostAddr = els.hostAddress.value.trim();
    if (!hostAddr) {
      toast(
        "Paste or type the Host address your friend sent you (from their Copy invite).",
        "error"
      );
      return;
    }
    state.joinHostAddressRaw = hostAddr;
    const wsUrl = toWsUrl(hostAddr);
    if (!wsUrl) {
      toast(
        "That doesn’t look like a valid address. Ask your friend to tap Copy invite again.",
        "error"
      );
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
