# Stops the API and the tunnel.
#
# The API is found by the port it holds rather than by image name: `node` is
# also every other Node project on this machine, and killing those would be a
# surprise.

$ErrorActionPreference = 'Stop'

$api = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
if ($api) {
  $api | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force
    Write-Host "Stopped the API (PID $_)"
  }
} else {
  Write-Host "Nothing was listening on 3100"
}

$tunnel = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($tunnel) {
  $tunnel | Stop-Process -Force
  Write-Host "Stopped cloudflared"
} else {
  Write-Host "cloudflared was not running"
}
