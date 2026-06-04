"use strict";

const fs = require("fs");
const {
  getWintunAddonJsPath,
  getWintunDllPath,
  getNativeNodePath,
} = require("./wintun-paths.js");
const { applyVirtualLanRouting } = require("./network-setup.js");
const { cleanupStaleAdapter } = require("./wintun-cleanup.js");

/** @type {any | null} */
let wintunApi = null;
let packetHandlerAttached = false;

/** Library returns 1 on success for init / close / set_ipv4 (see tuntap-napi.cpp). */
const WINTUN_OK = 1;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadWintunApi() {
  if (wintunApi) return wintunApi;

  const nativePath = getNativeNodePath();
  if (!fs.existsSync(nativePath)) {
    throw new Error(`Native addon missing: ${nativePath}`);
  }

  const dllPath = getWintunDllPath();
  if (!fs.existsSync(dllPath)) {
    throw new Error(`wintun.dll missing: ${dllPath}`);
  }

  const native = require(nativePath);
  getWintunAddonJsPath();

  if (!native || typeof native.init !== "function") {
    throw new Error("Invalid WinTun native addon (init missing)");
  }

  native.get_wintun_dll_path = () => dllPath;
  wintunApi = native;
  return wintunApi;
}

async function releaseWintun(Wintun) {
  packetHandlerAttached = false;
  try {
    Wintun.close();
  } catch (_) {}
  await sleep(800);
}

/**
 * @param {{ adapterName: string, ip: string, prefix: number, onPacket: (buf: Buffer) => void }} opts
 */
async function startWinTun(opts) {
  const Wintun = loadWintunApi();
  Wintun.set_dll_path(getWintunDllPath());

  await releaseWintun(Wintun);
  cleanupStaleAdapter(opts.adapterName || "TunnelX");

  Wintun.init();

  const adapterName = opts.adapterName || "TunnelX";
  let sr;
  try {
    sr = Wintun.set_ipv4(adapterName, opts.ip, opts.prefix || 24);
  } catch (e) {
    await releaseWintun(Wintun);
    const msg = e && e.message ? String(e.message) : String(e);
    if (/not admin/i.test(msg)) {
      throw new Error(
        "Administrator rights required. Right-click TunnelX → Run as administrator, then join again."
      );
    }
    if (/^error$/i.test(msg.trim())) {
      throw new Error(
        "Could not create TunnelX network adapter (name already in use). Reboot the PC, or run scripts/repair-wintun.ps1 as Administrator."
      );
    }
    throw new Error(`WinTun.set_ipv4 error: ${msg}`);
  }

  if (sr !== WINTUN_OK) {
    await releaseWintun(Wintun);
    throw new Error(
      `WinTun.set_ipv4 failed (code ${sr}). Reboot or run scripts/repair-wintun.ps1 as Administrator.`
    );
  }

  if (packetHandlerAttached) {
    throw new Error("WinTun packet handler already active — restart TunnelX.");
  }

  try {
    const attached = Wintun.on_data((pkt) => {
      if (!pkt || !pkt.length || !opts.onPacket) return;
      const copy = Buffer.from(pkt);
      setImmediate(() => {
        try {
          opts.onPacket(copy);
        } catch (err) {
          console.error("WinTun onPacket error:", err);
        }
      });
    });
    if (attached === false) {
      throw new Error("WinTun could not start packet capture thread.");
    }
    packetHandlerAttached = true;
  } catch (e) {
    await releaseWintun(Wintun);
    throw e;
  }

  try {
    applyVirtualLanRouting(adapterName, opts.ip, opts.prefix || 24);
  } catch (e) {
    console.warn("routing setup:", e);
  }

  return {
    send: (packet) => {
      try {
        Wintun.send_data(packet);
      } catch (_) {}
    },
    stop: () => {
      void releaseWintun(Wintun).then(() => {
        wintunApi = null;
        try {
          const nativePath = getNativeNodePath();
          delete require.cache[require.resolve(nativePath)];
        } catch (_) {}
      });
    },
  };
}

function probeWinTun() {
  try {
    getNativeNodePath();
    getWintunDllPath();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      stage: "bundle",
      message: e && e.message ? e.message : String(e),
    };
  }
}

module.exports = { startWinTun, probeWinTun, loadWintunApi, WINTUN_OK };
