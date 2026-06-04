"use strict";

const path = require("path");
const fs = require("fs");

const PKG = "@xiaobaidadada/node-tuntap2-wintun";

function wintunDllName() {
  const arch =
    process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "x86" : process.arch;
  return arch ? `wintun-${arch}.dll` : "wintun.dll";
}

function candidateRoots() {
  const roots = [path.join(__dirname, "..")];
  if (process.resourcesPath) {
    roots.unshift(path.join(process.resourcesPath, "app.asar.unpacked"));
  }
  return roots;
}

function firstExisting(paths) {
  const tried = [];
  for (const p of paths) {
    tried.push(p);
    if (fs.existsSync(p)) return p;
  }
  const err = new Error("WinTun file not found in application bundle");
  err.tried = tried;
  throw err;
}

function getNativeNodePath() {
  const bundled = path.join(__dirname, "..", "native", "tuntap2Addon.node");
  const fromPkg = candidateRoots().map((root) =>
    path.join(
      root,
      "node_modules",
      PKG,
      "build",
      "Release",
      "tuntap2Addon.node"
    )
  );
  return firstExisting([bundled, ...fromPkg]);
}

function getWintunDllPath() {
  const name = wintunDllName();
  const bundled = path.join(__dirname, "..", "native", name);
  const fromPkg = candidateRoots().map((root) =>
    path.join(root, "node_modules", PKG, "wintun_dll", name)
  );
  return firstExisting([bundled, ...fromPkg]);
}

function getWintunAddonJsPath() {
  return firstExisting(
    candidateRoots().map((root) =>
      path.join(
        root,
        "node_modules",
        PKG,
        "dist",
        "src",
        "ts",
        "win",
        "WintunAddon.js"
      )
    )
  );
}

module.exports = {
  getWintunAddonJsPath,
  getWintunDllPath,
  getNativeNodePath,
  candidateRoots,
};
