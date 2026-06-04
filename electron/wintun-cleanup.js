"use strict";

const { execSync } = require("child_process");

function runNetsh(cmd) {
  try {
    execSync(cmd, { stdio: "ignore", windowsHide: true });
  } catch (_) {}
}

/** Disable a leftover TunnelX NIC before creating a new WinTun adapter. */
function cleanupStaleAdapter(adapterName) {
  if (process.platform !== "win32") return;
  const name = adapterName || "TunnelX";
  runNetsh(`netsh interface set interface "${name}" disable`);
}

module.exports = { cleanupStaleAdapter };
