# Starts the two processes phaphak.com needs, and leaves them running.
#
#   node dist/main       the API, which also serves both web apps and the photos
#   cloudflared tunnel   the only thing that makes any of it reachable
#
# Both write to deploy\logs\. Stop them with stop.ps1.
#
# Nothing here restarts a process that dies — install-autostart.ps1 registers
# the scheduled tasks that do.

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$logs    = Join-Path $PSScriptRoot 'logs'

if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Force $logs | Out-Null }

# The API refuses to start on a taken port with an error that scrolls past in a
# log file, so it is caught here instead.
$busy = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  throw "Port 3100 is already in use (PID $($busy[0].OwningProcess)). Run deploy\stop.ps1 first, or leave the API you already have running."
}

if (-not (Test-Path (Join-Path $backend 'dist\main.js'))) {
  throw "backend\dist is missing — run deploy\build.ps1 first."
}

# Resolved here, before anything is started, rather than at the point of use.
# cloudflared was installed to a per-user folder, so it is on the PATH of the
# shell that installed it and of shells opened since — but not of one that was
# already open. Discovering that after the API has started leaves the site down
# with the API running and nothing serving it, which is exactly what happened.
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  $fallback = Join-Path $env:LOCALAPPDATA 'cloudflared\cloudflared.exe'
  if (Test-Path $fallback) { $cloudflared = $fallback }
}
if (-not $cloudflared) {
  throw "cloudflared was not found on PATH or in $env:LOCALAPPDATA\cloudflared. Nothing was started."
}

Start-Process -FilePath 'node' -ArgumentList 'dist/main' `
  -WorkingDirectory $backend -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs 'api.log') `
  -RedirectStandardError  (Join-Path $logs 'api.err.log')
Write-Host "API starting on http://localhost:3100/api"

# Waits for the API rather than starting the tunnel beside it: a tunnel that
# connects first serves 502s to anyone already on the site.
$ready = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3100/api/health' -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (-not $ready) { throw "The API did not answer /api/health within 30s — see deploy\logs\api.err.log" }
Write-Host "API is up." -ForegroundColor Green

Start-Process -FilePath $cloudflared -ArgumentList 'tunnel', 'run', 'laostay' `
  -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs 'tunnel.log') `
  -RedirectStandardError  (Join-Path $logs 'tunnel.err.log')
Write-Host "Tunnel starting."

Write-Host ""
Write-Host "https://phaphak.com        guest site" -ForegroundColor Green
Write-Host "https://admin.phaphak.com  WebAdmin"   -ForegroundColor Green
