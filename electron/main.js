"use strict";

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");

function logCrash(label, err) {
  const msg = err && err.stack ? err.stack : String(err);
  console.error(label, msg);
  try {
    fs.appendFileSync(
      path.join(app.getPath("temp"), "tunnelx-crash.log"),
      `\n[${new Date().toISOString()}] ${label}\n${msg}\n`
    );
  } catch (_) {}
}

process.on("uncaughtException", (err) => {
  logCrash("uncaughtException", err);
  try {
    dialog.showErrorBox(
      "TunnelX error",
      (err && err.message) || String(err)
    );
  } catch (_) {}
});

process.on("unhandledRejection", (reason) => {
  logCrash("unhandledRejection", reason);
});

const dgram = require("dgram");
const relay = require(path.join(__dirname, "..", "lib", "relay.js"));
const { getHostNetworkInfo } = require(path.join(__dirname, "host-network.js"));
const {
  ensureTun,
  releaseTun,
  stopActiveTun,
  getTunPreflight,
} = require(path.join(__dirname, "session-tun.js"));

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {{ httpPort: number, udpPort: number, stop: () => void } | null} */
let embeddedServer = null;
let embeddedServerStartedHere = false;

/** @type {null | { id: number, udp: import("dgram").Socket, tun: { send: (b: Buffer) => void, stop: () => void } | null, regTimer: ReturnType<typeof setInterval> | null }} */
let liveSession = null;
let nextSessionId = 1;

function sendUdpRegistration(udp, opts) {
  const regFrame = relay.build(
    "APP",
    opts.roomId,
    Buffer.concat([Buffer.from("REG|"), Buffer.from(opts.peerId, "utf8")])
  );
  udp.send(regFrame, opts.relayPort, opts.serverHost, (err) => {
    if (err) console.error("REG send error:", err);
  });
}

function shouldUseTun() {
  return process.platform === "win32" && process.env.LANBRIDGE_TUN !== "0";
}

function stopLiveSession() {
  if (liveSession) {
    if (liveSession.regTimer) {
      clearInterval(liveSession.regTimer);
      liveSession.regTimer = null;
    }
    releaseTun(liveSession.id);
    try {
      liveSession.udp.close();
    } catch (_) {}
    liveSession = null;
  } else {
    stopActiveTun();
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
  const sessionId = nextSessionId++;

  return new Promise((resolve, reject) => {
    stopLiveSession();

    const roomHex = relay.normalizeRoomId(opts.roomId);
    const udp = dgram.createSocket("udp4");

    udp.once("error", (err) => {
      releaseTun(sessionId);
      reject(err);
    });

    udp.bind(0, "0.0.0.0", () => {
      const session = { id: sessionId, udp, tun: null, regTimer: null };
      liveSession = session;

      udp.on("message", (msg) => {
        const p = relay.parse(msg);
        if (!liveSession || liveSession.id !== sessionId || !p || p.roomHex !== roomHex) {
          return;
        }
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
        /** @type {string | undefined} */
        let tunError;

        try {
        if (shouldUseTun()) {
          const onPacket = (buf) => {
            if (!liveSession || liveSession.id !== sessionId || !relay.isIPv4Packet(buf)) {
              return;
            }
            let frame;
            try {
              frame = relay.build("IP4", opts.roomId, buf);
            } catch {
              return;
            }
            udp.send(frame, opts.relayPort, opts.serverHost, (err) => {
              if (err) console.error("relay send error:", err);
            });
          };

          try {
            const tun = await ensureTun(sessionId, {
              adapterName: "TunnelX",
              ip: opts.virtualIp,
              prefix: 24,
              onPacket,
            });
            if (liveSession && liveSession.id === sessionId) {
              liveSession.tun = tun;
            }
          } catch (e) {
            tunError =
              e && typeof e === "object" && "message" in e
                ? String(e.message)
                : String(e);
            console.warn("WinTun start failed:", tunError);
          }
        } else {
          tunError = "LAN adapter disabled (LANBRIDGE_TUN=0)";
        }

        sendUdpRegistration(udp, opts);
        if (liveSession && liveSession.id === sessionId) {
          liveSession.regTimer = setInterval(
            () => sendUdpRegistration(udp, opts),
            25000
          );
        }

        const tunUp = !!(liveSession && liveSession.id === sessionId && liveSession.tun);

        resolve({
          ok: true,
          tun: tunUp,
          tunError: tunUp
            ? undefined
            : tunError ||
              "Virtual LAN adapter did not start. Run as Administrator and re-join.",
        });
        } catch (fatal) {
          logCrash("startLiveSession", fatal);
          resolve({
            ok: true,
            tun: false,
            tunError:
              fatal && fatal.message
                ? fatal.message
                : "Session start failed unexpectedly.",
          });
        }
      })();
    });
  });
}

ipcMain.handle("lb-tun-preflight", () => getTunPreflight());

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
  stopActiveTun();
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
