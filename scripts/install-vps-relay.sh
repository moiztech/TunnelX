#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/tunnelx-relay"
SERVICE_FILE="/etc/systemd/system/tunnelx-relay.service"

if ! command -v node >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y nodejs npm
fi

sudo mkdir -p "$APP_DIR/server" "$APP_DIR/lib"
sudo cp -r server/. "$APP_DIR/server/"
sudo cp -r lib/. "$APP_DIR/lib/"
sudo chown -R "$USER":"$USER" "$APP_DIR"

cd "$APP_DIR/server"
npm install --omit=dev

sudo tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=TunnelX public relay server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/server
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=3
Environment=LANBRIDGE_HTTP_PORT=8787
Environment=LANBRIDGE_UDP_PORT=17777
User=$USER

[Install]
WantedBy=multi-user.target
SERVICE

if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 8787/tcp || true
  sudo ufw allow 17777/udp || true
fi

sudo systemctl daemon-reload
sudo systemctl enable tunnelx-relay
sudo systemctl restart tunnelx-relay
sudo systemctl --no-pager --full status tunnelx-relay
