"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lanbridge", {
  platform: process.platform,
  appVersion: () => ipcRenderer.invoke("lb-app-version"),
  getHostNetworkInfo: () => ipcRenderer.invoke("lb-host-network-info"),
  tunPreflight: () => ipcRenderer.invoke("lb-tun-preflight"),
});

contextBridge.exposeInMainWorld("lanbridgeHost", {
  ensureServer() {
    return ipcRenderer.invoke("lb-ensure-server");
  },
});

contextBridge.exposeInMainWorld("lanbridgeSession", {
  start(opts) {
    return ipcRenderer.invoke("lb-session-start", opts);
  },
  stop() {
    return ipcRenderer.invoke("lb-session-stop");
  },
});
