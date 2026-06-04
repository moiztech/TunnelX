"use strict";

const path = require("path");
const http = require("http");
const dgram = require("dgram");
const { WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");
const relay = require(path.join(__dirname, "..", "lib", "relay.js"));

const DEFAULT_HTTP = 8787;
const DEFAULT_UDP = 17777;
/** Virtual LAN subnet per LANBridge spec (10.0.0.0/24). */
const BASE_VIRTUAL = [10, 0, 0, 0];

function virtualIpFromIndex(i) {
  const o = BASE_VIRTUAL.slice();
  o[3] = i;
  return o.join(".");
}

function nextVirtualIndex(room) {
  return room.peers.size + 2;
}

/**
 * @param {{ httpPort?: number, udpPort?: number, quiet?: boolean }} options
 * @returns {Promise<{ httpPort: number, udpPort: number, stop: () => void }>}
 */
function startLanBridgeServer(options = {}) {
  const HTTP_PORT = Number(options.httpPort ?? DEFAULT_HTTP);
  const UDP_PORT = Number(options.udpPort ?? DEFAULT_UDP);
  const quiet = !!options.quiet;

  /** @type {Map<string, { id: string, name: string, peers: Map<string, any>, created: number }>} */
  const roomsByName = new Map();

  function removePeerFromRoom(room, peerId) {
    room.peers.delete(peerId);
    if (room.peers.size === 0) {
      roomsByName.delete(room.name);
    }
  }

  function broadcastRoomState(room, exceptPeerId) {
    const members = [];
    for (const p of room.peers.values()) {
      members.push({
        id: p.id,
        name: p.name,
        virtualIp: p.virtualIp,
        hasUdp: !!p.udpAddr,
      });
    }
    const payload = JSON.stringify({
      type: "room_state",
      room: room.name,
      roomId: room.id,
      members,
      relayUdpPort: UDP_PORT,
      serverTime: Date.now(),
    });
    for (const p of room.peers.values()) {
      if (p.ws.readyState === 1 && p.id !== exceptPeerId) {
        p.ws.send(payload);
      }
    }
  }

  const udpSocket = dgram.createSocket("udp4");

  udpSocket.on("message", (msg, rinfo) => {
    const parsed = relay.parse(msg);
    if (!parsed) return;

    let targetRoom = null;
    for (const r of roomsByName.values()) {
      if (relay.normalizeRoomId(r.id) === parsed.roomHex) {
        targetRoom = r;
        break;
      }
    }
    if (!targetRoom) return;

    let sender = null;
    for (const p of targetRoom.peers.values()) {
      if (
        p.udpAddr &&
        p.udpAddr.address === rinfo.address &&
        p.udpAddr.port === rinfo.port
      ) {
        sender = p;
        break;
      }
    }

    if (!sender) {
      if (parsed.payload.length === 0) return;
      const text = parsed.payload.toString("utf8");
      if (text.startsWith("REG|")) {
        const peerId = text.slice(4);
        const peer = targetRoom.peers.get(peerId);
        if (peer) {
          peer.udpAddr = {
            address: rinfo.address,
            port: rinfo.port,
            family: "IPv4",
          };
          peer.lastSeen = Date.now();
          broadcastRoomState(targetRoom);
        }
      }
      return;
    }

    sender.lastSeen = Date.now();
    if (parsed.payload.length === 0) return;

    const roomBin = Buffer.from(parsed.roomHex, "hex");

    for (const p of targetRoom.peers.values()) {
      if (p.id === sender.id || !p.udpAddr) continue;
      const magic =
        parsed.kind === "IP4"
          ? Buffer.from("LANT")
          : Buffer.from("LANB");
      const out = Buffer.concat([
        magic,
        roomBin,
        Buffer.from(parsed.payload),
      ]);
      udpSocket.send(out, p.udpAddr.port, p.udpAddr.address, (err) => {
        if (err && !quiet) console.error("udp forward error:", err.message);
      });
    }
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, rooms: roomsByName.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    let ctx = null;

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const action = data.action;
      const displayName =
        typeof data.name === "string" ? data.name.trim() || "Player" : "Player";

      if (action === "create") {
        if (ctx) return;
        const roomName = typeof data.room === "string" ? data.room.trim() : "";
        if (!roomName || roomName.length > 64) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid room name" }));
          return;
        }
        if (roomsByName.has(roomName)) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Room already exists — use Join",
            })
          );
          return;
        }
        const room = {
          id: randomUUID(),
          name: roomName,
          peers: new Map(),
          created: Date.now(),
        };
        roomsByName.set(roomName, room);
        const peerId = randomUUID();
        const index = nextVirtualIndex(room);
        const virtualIp = virtualIpFromIndex(index);
        const peer = {
          id: peerId,
          ws,
          name: displayName,
          virtualIp,
          udpAddr: null,
          lastSeen: Date.now(),
        };
        room.peers.set(peerId, peer);
        ctx = { room, peer };
        ws.send(
          JSON.stringify({
            type: "welcome",
            role: "host",
            peerId,
            virtualIp,
            room: room.name,
            roomId: room.id,
            relayUdpPort: UDP_PORT,
            members: Array.from(room.peers.values()).map((p) => ({
              id: p.id,
              name: p.name,
              virtualIp: p.virtualIp,
              hasUdp: !!p.udpAddr,
            })),
          })
        );
        broadcastRoomState(room, peerId);
        return;
      }

      if (action === "join") {
        if (ctx) return;
        const roomName = typeof data.room === "string" ? data.room.trim() : "";
        if (!roomName || roomName.length > 64) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid room name" }));
          return;
        }
        const room = roomsByName.get(roomName);
        if (!room) {
          ws.send(
            JSON.stringify({ type: "error", message: "Room not found" })
          );
          return;
        }
        const peerId = randomUUID();
        const index = nextVirtualIndex(room);
        const virtualIp = virtualIpFromIndex(index);
        const peer = {
          id: peerId,
          ws,
          name: displayName,
          virtualIp,
          udpAddr: null,
          lastSeen: Date.now(),
        };
        room.peers.set(peerId, peer);
        ctx = { room, peer };
        ws.send(
          JSON.stringify({
            type: "welcome",
            role: "joiner",
            peerId,
            virtualIp,
            room: room.name,
            roomId: room.id,
            relayUdpPort: UDP_PORT,
            members: Array.from(room.peers.values()).map((p) => ({
              id: p.id,
              name: p.name,
              virtualIp: p.virtualIp,
              hasUdp: !!p.udpAddr,
            })),
          })
        );
        broadcastRoomState(room);
        return;
      }

      if (action === "ping" && data.t && ctx) {
        ctx.peer.lastSeen = Date.now();
        ws.send(JSON.stringify({ type: "pong", t: data.t }));
        return;
      }

      if (action === "leave" && ctx) {
        const { room, peer } = ctx;
        removePeerFromRoom(room, peer.id);
        broadcastRoomState(room);
        ctx = null;
        ws.close();
      }
    });

    ws.on("close", () => {
      if (!ctx) return;
      const { room, peer } = ctx;
      removePeerFromRoom(room, peer.id);
      broadcastRoomState(room);
      ctx = null;
    });
  });

  return new Promise((resolve, reject) => {
    udpSocket.once("error", reject);
    udpSocket.bind(UDP_PORT, () => {
      udpSocket.removeListener("error", reject);
      server.once("error", reject);
      server.listen(HTTP_PORT, () => {
        server.removeListener("error", reject);
        if (!quiet) {
          console.log(
            `TunnelX UDP relay listening on ${UDP_PORT}/udp`
          );
          console.log(
            `TunnelX signaling http://127.0.0.1:${HTTP_PORT}  ws path /ws`
          );
        }
        resolve({
          httpPort: HTTP_PORT,
          udpPort: UDP_PORT,
          stop() {
            try {
              wss.close();
            } catch (_) {}
            try {
              server.close();
            } catch (_) {}
            try {
              udpSocket.close();
            } catch (_) {}
          },
        });
      });
    });
  });
}

module.exports = { startLanBridgeServer, DEFAULT_HTTP, DEFAULT_UDP };
