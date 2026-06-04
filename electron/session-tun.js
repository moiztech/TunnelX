"use strict";

const { isWindowsAdmin } = require("./admin.js");
const { startTunBridge } = require("./tun-bridge.js");
const { applyVirtualLanRouting } = require("./network-setup.js");
const { getNativeNodePath, getWintunDllPath } = require("./wintun-paths.js");
const fs = require("fs");

/** @type {{ stop: () => void } | null} */
let activeTun = null;
let activeTunSessionId = 0;
/** @type {Promise<unknown>} */
let tunStartChain = Promise.resolve();

function stopActiveTun() {
  if (activeTun) {
    try {
      activeTun.stop();
    } catch (_) {}
    activeTun = null;
    activeTunSessionId = 0;
  }
}

/**
 * @param {number} sessionId
 * @param {{ adapterName: string, ip: string, prefix: number, onPacket: (buf: Buffer) => void }} opts
 */
async function ensureTun(sessionId, opts) {
  if (process.platform !== "win32") {
    throw new Error("Virtual LAN is only supported on Windows");
  }
  if (process.env.LANBRIDGE_TUN === "0") {
    throw new Error("LAN adapter disabled (LANBRIDGE_TUN=0)");
  }
  if (!isWindowsAdmin()) {
    throw new Error(
      "Administrator rights required. Close TunnelX, right-click → Run as administrator, then join again."
    );
  }

  if (activeTun && activeTunSessionId === sessionId) {
    return activeTun;
  }

  const run = async () => {
    stopActiveTun();
    const tun = await startTunBridge(opts);
    try {
      applyVirtualLanRouting(
        opts.adapterName || "TunnelX",
        opts.ip,
        opts.prefix || 24
      );
    } catch (e) {
      console.warn("routing:", e);
    }
    activeTun = tun;
    activeTunSessionId = sessionId;
    return tun;
  };

  const p = tunStartChain.then(run, run);
  tunStartChain = p.catch(() => {});
  return p;
}

function releaseTun(sessionId) {
  if (activeTunSessionId === sessionId) {
    stopActiveTun();
  }
}

function getTunPreflight() {
  const admin = isWindowsAdmin();
  if (process.platform !== "win32") {
    return { ok: false, admin, message: "Windows only" };
  }
  if (!admin) {
    return {
      ok: false,
      admin: false,
      message:
        "Run TunnelX as Administrator (right-click the app → Run as administrator).",
    };
  }
  try {
    getNativeNodePath();
    getWintunDllPath();
    const { findRunnerPath } = require("./tun-bridge.js");
    const runner = findRunnerPath();
    if (!fs.existsSync(runner)) {
      return {
        ok: false,
        admin: true,
        message: "LAN worker (node.exe) missing — run npm run dist again.",
      };
    }
    return { ok: true, admin: true, message: "WinTun ready" };
  } catch (e) {
    return {
      ok: false,
      admin: true,
      message: e && e.message ? e.message : String(e),
    };
  }
}

module.exports = {
  ensureTun,
  releaseTun,
  stopActiveTun,
  getTunPreflight,
};
