# TunnelX by E11 Labs

A simple Windows desktop app to play **classic LAN multiplayer** with friends over the internet. **Host** creates a room on the public relay; **Join** connects to the same relay and room.

## For players (no developer tools)

1. Install **`TunnelX-Setup-1.0.0.exe`** (installer with desktop shortcut) **or** run **`TunnelX-1.0.0-Portable.exe`** (no install; copy via USB / chat).
2. **Host:** choose **Host**, enter a room name, click **Host lobby**. The app connects to the public TunnelX relay server.
3. **Join:** choose **Join**, use the same server address and room name, then click **Join lobby**.
4. Open your game and use **LAN / local network** multiplayer.

Branding assets: `build/icon.ico` (Windows icon) and `renderer/assets/logo.png` (in-app logo), copied from the project root artwork when building.

## Build installers (developers)

```bash
npm install
npm run dist
```

**No Visual Studio required.** The WinTun driver uses a **prebuilt** binary (`prebuild-install`).

Run all commands from the **project root** (`LANBrige`), **not** from the `dist` folder.

`npm audit` may still list issues inside `electron-builder`; those are **dev build tools only** — they are not bundled into the portable `.exe` you send to friends. **Do not run `npm audit fix --force`** (it breaks the project).

If `npm run dist` complains about rebuilding native code, ensure `package.json` has `"npmRebuild": false` and run:

```bash
cd node_modules\@xiaobaidadada\node-tuntap2-wintun
npm run install
cd ..\..\..
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

- **Lobby (relay):** Host and Join connect to the relay on **8787** (WebSocket) and **17777** (UDP). Everyone in the same room name appears in TunnelX’s player list.
- **In-game LAN (WinTun):** Classic games (e.g. Stronghold) only see other players when the **TunnelX** virtual network adapter is running. That adapter needs **Administrator** rights on Windows. You do **not** need Visual Studio if `npm install` already downloaded the prebuilt WinTun addon (default).

### Stronghold / LAN games not discovering each other?

1. In TunnelX, after joining, check **Tunnel status**. It must say **LAN adapter running**. If it says the adapter is off, run TunnelX **as Administrator** and re-join the room.
2. **Every** player needs the adapter running (same room name, same relay server).
3. Open the game only **after** TunnelX shows you in the lobby with the adapter running.
4. In the game, use **LAN / local network** (not internet / GameSpy).
5. Allow TunnelX through Windows Firewall (private networks).
6. From source: `npm run client` — start your terminal **as Administrator** so WinTun can create the adapter.

To disable the adapter (lobby-only testing): set `LANBRIDGE_TUN=0` before starting the app.

## Protocol

WebSocket path `/ws`; UDP relay uses `LANB` / `LANT` framing (see `lib/relay.js`).
