"use strict";

/**
 * WinTun worker (separate Node process). Crashes here do not close the Electron UI.
 */

const net = require("net");
const { getNativeNodePath, getWintunDllPath } = require("./wintun-paths.js");

const WINTUN_OK = 1;

/** @type {any} */
let Wintun = null;

function getWintun() {
  if (!Wintun) {
    Wintun = require(getNativeNodePath());
    if (!Wintun || typeof Wintun.init !== "function") {
      throw new Error("Invalid WinTun native addon");
    }
    Wintun.get_wintun_dll_path = () => getWintunDllPath();
  }
  return Wintun;
}

const parentPort = parseInt(process.argv[2], 10);
if (!parentPort || Number.isNaN(parentPort)) {
  console.error("Usage: node tun-service.js <port>");
  process.exit(1);
}

function writeFrame(sock, type, body) {
  const h = Buffer.alloc(5);
  h[0] = type & 0xff;
  h.writeUInt32BE(body.length, 1);
  sock.write(Buffer.concat([h, body]));
}

const sock = net.connect(parentPort, "127.0.0.1");

let buf = Buffer.alloc(0);
let started = false;

sock.on("error", (err) => {
  console.error("tun-service socket:", err.message);
  try {
    if (Wintun) Wintun.close();
  } catch (_) {}
  process.exit(1);
});

sock.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 5) {
    const t = buf[0];
    const len = buf.readUInt32BE(1);
    if (len > 8 * 1024 * 1024) {
      sock.destroy();
      return;
    }
    if (buf.length < 5 + len) return;
    const body = buf.subarray(5, 5 + len);
    buf = buf.subarray(5 + len);

    if (t === 0) {
      let j;
      try {
        j = JSON.parse(body.toString("utf8"));
      } catch {
        writeFrame(
          sock,
          0,
          Buffer.from(JSON.stringify({ ok: false, error: "bad control json" }))
        );
        continue;
      }
      if (j.cmd === "stop") {
        try {
          if (Wintun) Wintun.close();
        } catch (_) {}
        try {
          sock.end();
        } catch (_) {}
        process.exit(0);
        return;
      }
      if (j.cmd === "start" && !started) {
        try {
          const Wintun = getWintun();
          Wintun.set_dll_path(getWintunDllPath());
          try {
            Wintun.close();
          } catch (_) {}
          Wintun.init();
          const sr = Wintun.set_ipv4(
            j.adapterName || "TunnelX",
            j.ip,
            j.prefix || 24
          );
          if (sr !== WINTUN_OK) {
            throw new Error(
              `Wintun.set_ipv4 failed (${sr}). Run TunnelX as Administrator.`
            );
          }
          Wintun.on_data((pkt) => {
            if (pkt && pkt.length) writeFrame(sock, 2, pkt);
          });
          started = true;
          writeFrame(sock, 0, Buffer.from(JSON.stringify({ ok: true })));
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          writeFrame(
            sock,
            0,
            Buffer.from(JSON.stringify({ ok: false, error: msg }))
          );
          try {
            sock.end();
          } catch (_) {}
        }
      }
      continue;
    }

    if (t === 1 && started) {
      try {
        getWintun().send_data(body);
      } catch (_) {}
    }
  }
});
