"use strict";

const { execSync } = require("child_process");

function isWindowsAdmin() {
  if (process.platform !== "win32") return true;
  try {
    execSync("net session", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = { isWindowsAdmin };
