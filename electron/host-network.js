"use strict";

const os = require("os");

/**
 * Prefer real LAN adapters over virtual VPN / VM interfaces.
 * @param {string} name
 */
function scoreIfaceName(name) {
  const l = String(name).toLowerCase();
  if (
    /vbox|virtualbox|vmware|hyper-v|vethernet|npcap|nordlynx|windscribe|proton|tun|tap|tailscale|hamachi|zerotier|docker|wsl|bluestacks/i.test(
      l
    )
  ) {
    return 8;
  }
  if (/ethernet|eth\b|syncernet|local area connection/i.test(l)) return 100;
  if (/wi-?fi|wlan|wireless|802\.11/i.test(l)) return 90;
  return 50;
}

/**
 * @returns {{ primary: string, addresses: { name: string, address: string }[] }}
 */
function getHostNetworkInfo() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const fam = net.family;
      if (fam !== "IPv4" && fam !== 4) continue;
      if (net.internal) continue;
      const addr = net.address;
      if (!addr || addr.startsWith("169.254.")) continue;
      candidates.push({
        name,
        address: addr,
        score: scoreIfaceName(name),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const primary = candidates[0]?.address || "";
  return {
    primary,
    addresses: candidates.map((c) => ({ name: c.name, address: c.address })),
  };
}

module.exports = { getHostNetworkInfo };
