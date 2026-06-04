param(
  [string]$HostName = "98.70.25.166",
  [string]$UserName = "itiproject"
)

$ErrorActionPreference = "Stop"

$remote = "$UserName@$HostName"
$remoteDir = "/tmp/tunnelx-relay-deploy"

Write-Host "Preparing TunnelX relay deployment on $remote ..."
ssh $remote "rm -rf $remoteDir && mkdir -p $remoteDir"

Write-Host "Uploading relay files. Enter the VPS password if asked."
scp -r server lib scripts/install-vps-relay.sh "${remote}:${remoteDir}/"

Write-Host "Installing and starting the relay service. Enter the VPS password if asked."
ssh $remote "cd $remoteDir && chmod +x install-vps-relay.sh && bash install-vps-relay.sh"

Write-Host "TunnelX relay deployment finished."
