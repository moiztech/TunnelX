"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const dgram = require("dgram");
const relay = require(path.join(__dirname, "..", "lib", "relay.js"));
const { getHostNetworkInfo } = require(path.join(__dirname, "host-network.js"));

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {{ httpPort: number, udpPort: number, stop: () => void } | null} */
let embeddedServer = null;
let embeddedServerStartedHere = false;

/** @type {null | { udp: import("dgram").Socket, tun: { send: (b: Buffer) => void, stop: () => void } | null }} */
let liveSession = null;

function shouldUseTun() {
  return (
    process.platform === "win32" &&
    process.env.LANBRIDGE_TUN !== "0"
  );
}

function stopLiveSession() {
  if (liveSession) {
    try {
      if (liveSession.tun) liveSession.tun.stop();
    } catch (_) {}
    try {
      liveSession.udp.close();
    } catch (_) {}
    liveSession = null;
  }
}

function stopEmbeddedServerIfOurs() {
  if (embeddedServerStartedHere && embeddedServer) {
    try {
      embeddedServer.stop();
    } catch (_) {}
    embeddedServer = null;
    embeddedServerStartedHere = false;
  }
}

/**
 * @param {{ relayPort: number, serverHost: string, roomId: string, peerId: string, virtualIp: string }} opts
 */
function startLiveSession(opts) {
  return new Promise((resolve, reject) => {
    stopLiveSession();

    const roomHex = relay.normalizeRoomId(opts.roomId);

    const udp = dgram.createSocket("udp4");
    udp.once("error", (err) => {
      stopLiveSession();
      reject(err);
    });

    udp.bind(0, "0.0.0.0", () => {
      liveSession = { udp, tun: null };

      udp.on("message", (msg) => {
        const p = relay.parse(msg);
        if (!liveSession || !p || p.roomHex !== roomHex) return;
        if (p.kind !== "IP4") return;
        if (liveSession.tun && relay.isIPv4Packet(p.payload)) {
          try {
            liveSession.tun.send(p.payload);
          } catch (e) {
            console.error("tun inject error:", e);
          }
        }
      });

      void (async () => {
        if (shouldUseTun()) {
          try {
            const { startTunBridge } = require(path.join(
              __dirname,
              "tun-bridge.js"
            ));
            const tun = await startTunBridge({
              adapterName: "TunnelX",
              ip: opts.virtualIp,
              prefix: 24,
              onPacket: (buf) => {
                if (!liveSession || !relay.isIPv4Packet(buf)) return;
                let frame;
                try {
                  frame = relay.build("IP4", opts.roomId, buf);
                } catch {
                  return;
                }
                udp.send(frame, opts.relayPort, opts.serverHost, (err) => {
                  if (err) console.error("relay send error:", err);
                });
              },
            });
            if (liveSession) liveSession.tun = tun;
          } catch (e) {
            console.warn("WinTun unavailable:", e.message || e);
          }
        }

        const regFrame = relay.build(
          "APP",
          opts.roomId,
          Buffer.concat([Buffer.from("REG|"), Buffer.from(opts.peerId, "utf8")])
        );
        udp.send(regFrame, opts.relayPort, opts.serverHost, (err) => {
          if (err) console.error("REG send error:", err);
        });

        resolve({
          ok: true,
          tun: !!liveSession?.tun,
        });
      })();
    });
  });
}

ipcMain.handle("lb-ensure-server", async () => {
  const { startLanBridgeServer, DEFAULT_HTTP, DEFAULT_UDP } = require(path.join(
    __dirname,
    "..",
    "server",
    "app.js"
  ));

  if (embeddedServer && embeddedServerStartedHere) {
    return {
      ok: true,
      httpPort: embeddedServer.httpPort,
      udpPort: embeddedServer.udpPort,
      local: true,
    };
  }

  try {
    embeddedServer = await startLanBridgeServer({
      httpPort: DEFAULT_HTTP,
      udpPort: DEFAULT_UDP,
      quiet: true,
    });
    embeddedServerStartedHere = true;
    return {
      ok: true,
      httpPort: embeddedServer.httpPort,
      udpPort: embeddedServer.udpPort,
      local: true,
    };
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    if (err.code === "EADDRINUSE") {
      embeddedServerStartedHere = false;
      embeddedServer = null;
      return {
        ok: true,
        httpPort: DEFAULT_HTTP,
        udpPort: DEFAULT_UDP,
        local: false,
        note: "in_use",
      };
    }
    return {
      ok: false,
      message:
        err.message ||
        "Could not start the lobby server. Check that ports 8787 and 17777 are free.",
    };
  }
});

ipcMain.handle("lb-session-start", async (_e, opts) => {
  try {
    return await startLiveSession(opts);
  } catch (e) {
    stopLiveSession();
    return {
      ok: false,
      tun: false,
      tunError: e && e.message ? e.message : String(e),
    };
  }
});

ipcMain.handle("lb-session-stop", async () => {
  stopLiveSession();
  return true;
});

ipcMain.handle("lb-app-version", () => app.getVersion());

ipcMain.handle("lb-host-network-info", () => getHostNetworkInfo());

function createWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 820,
    minWidth: 380,
    minHeight: 640,
    title: "TunnelX",
    backgroundColor: "#0c0e12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  win.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopLiveSession();
  stopEmbeddedServerIfOurs();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopLiveSession();
  stopEmbeddedServerIfOurs();
});
