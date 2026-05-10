# TunnelX by E11 Labs

A simple Windows desktop app to play **classic LAN multiplayer** with friends over the internet. **Host** starts a lobby on your PC; **Join** connects to a friend using their address.

## For players (no developer tools)

1. Install **`TunnelX-Setup-1.0.0.exe`** (installer with desktop shortcut) **or** run **`TunnelX-1.0.0-Portable.exe`** (no install; copy via USB / chat).
2. **Host:** choose **Host**, enter a room name, click **Host lobby**. Windows may ask to allow **private network** access the first time (signaling ports **8787** UDP **17777**).
3. **Join:** choose **Join**, enter the host’s IP or PC name (same Wi‑Fi) or their public IP/hostname (online), same room name, click **Join lobby**.
4. Open your game and use **LAN / local network** multiplayer.

Branding assets: `build/icon.ico` (Windows icon) and `renderer/assets/logo.png` (in-app logo), copied from the project root artwork when building.

## Build installers (developers)

```bash
npm install
npm run dist
```

Outputs in **`dist/`**:

| File | Purpose |
|------|---------|
| `TunnelX-Setup-<version>.exe` | NSIS installer, Start Menu + optional desktop shortcut |
| `TunnelX-<version>-Portable.exe` | Single portable executable |

If packaging fails on **code signing / symlinks**, use:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run dist
```

The project sets `signAndEditExecutable: false` and `npmRebuild: false` so a full Visual Studio toolchain is not required for packaging.

## Run from source

```bash
npm run client
```

Optional standalone signaling server:

```bash
npm run server
```

Environment variables (optional): `LANBRIDGE_HTTP_PORT`, `LANBRIDGE_UDP_PORT`, `LANBRIDGE_TUN`, `LANBRIDGE_NODE`.

## How it works

- **Embedded lobby server:** When you **Host**, the app starts signaling (HTTP/WebSocket) and UDP relay on **8787** / **17777** on your machine.
- **Virtual adapter (WinTun):** Optional in **non-packaged** dev builds on Windows; the shipped `.exe` focuses on relay and UX first.

## Protocol

WebSocket path `/ws`; UDP relay uses `LANB` / `LANT` framing (see `lib/relay.js`).
