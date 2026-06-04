"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const nativeDir = path.join(root, "native");
const nativeBin = path.join(
  root,
  "node_modules",
  "@xiaobaidadada",
  "node-tuntap2-wintun",
  "build",
  "Release",
  "tuntap2Addon.node"
);

function copyBundledNative() {
  if (!fs.existsSync(nativeBin)) return;
  fs.mkdirSync(nativeDir, { recursive: true });
  fs.copyFileSync(
    nativeBin,
    path.join(nativeDir, "tuntap2Addon.node")
  );
  const dllSrc = path.join(
    root,
    "node_modules",
    "@xiaobaidadada",
    "node-tuntap2-wintun",
    "wintun_dll",
    "wintun-amd64.dll"
  );
  if (fs.existsSync(dllSrc)) {
    fs.copyFileSync(dllSrc, path.join(nativeDir, "wintun-amd64.dll"));
  }
}

if (fs.existsSync(nativeBin)) {
  copyBundledNative();
  process.exit(0);
}

const pkgDir = path.join(
  root,
  "node_modules",
  "@xiaobaidadada",
  "node-tuntap2-wintun"
);

if (!fs.existsSync(path.join(pkgDir, "package.json"))) {
  console.warn("ensure-wintun-prebuild: wintun package not installed yet");
  process.exit(0);
}

console.log("Downloading prebuilt WinTun binary (no Visual Studio needed)...");
execSync("npm run install", {
  cwd: pkgDir,
  stdio: "inherit",
  shell: true,
});

if (!fs.existsSync(nativeBin)) {
  console.error(
    "WinTun prebuild missing. Run: cd node_modules\\@xiaobaidadada\\node-tuntap2-wintun && npm run install"
  );
  process.exit(1);
}

copyBundledNative();
