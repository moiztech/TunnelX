# Run in Administrator PowerShell — resets stuck WinTun driver (optional maintenance).
# Not needed for the "init code 1" UI bug (fixed in tun-win.js); use if set_ipv4 still fails.

Write-Host "Stopping TunnelX / Electron..." -ForegroundColor Cyan
Get-Process -Name "TunnelX","electron" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Removing wintun kernel service (reinstalled on next TunnelX start)..." -ForegroundColor Cyan
sc.exe delete wintun 2>$null

Write-Host "Done. Start TunnelX as Administrator and join your room again." -ForegroundColor Green
