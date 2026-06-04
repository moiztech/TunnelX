"use strict";

const { execSync } = require("child_process");

/**
 * Prefer the TunnelX adapter and add an on-link route for the virtual LAN subnet.
 * Helps older games send LAN/broadcast traffic via the virtual NIC.
 */
function applyVirtualLanRouting(adapterName, virtualIp, prefix) {
  if (process.platform !== "win32") return;

  const name = adapterName || "TunnelX";
  const parts = String(virtualIp).split(".").map((x) => parseInt(x, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return;

  const maskBits = Number(prefix) || 24;
  const mask = [];
  for (let i = 0; i < 4; i++) {
    const bits = Math.max(0, Math.min(8, maskBits - i * 8));
    mask.push(bits === 0 ? 0 : (0xff << (8 - bits)) & 0xff);
  }
  const network = parts.map((b, i) => b & mask[i]).join(".");
  const maskStr = mask.join(".");

  const run = (cmd) => {
    try {
      execSync(cmd, { stdio: "ignore", windowsHide: true });
    } catch (e) {
      console.warn("network-setup:", cmd, e.message || e);
    }
  };

  run(`netsh interface ipv4 set interface name="${name}" metric=1`);
  run(`route delete ${network} mask ${maskStr} metric 1`);
  run(`route add ${network} mask ${maskStr} ${virtualIp} metric 1`);
}

module.exports = { applyVirtualLanRouting };
