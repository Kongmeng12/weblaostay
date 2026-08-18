# Rebuilds everything the tunnel serves: the API and the two web apps.
#
# Run after pulling or editing code. The backend serves webapp/dist and
# webadmin/dist straight off disk, so a rebuild is the whole of a deploy —
# there is nothing to upload.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

foreach ($part in @('backend', 'webapp', 'webadmin')) {
  $dir = Join-Path $root $part
  Write-Host ""
  Write-Host "── $part ──────────────────────────────────────────" -ForegroundColor Cyan
  Push-Location $dir
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "$part build failed" }
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Built." -ForegroundColor Green
# The web apps are already live: express.static and res.sendFile read from disk
# per request, so a fresh webapp/dist is served the moment it lands. Only the
# API's own code is held in the running process.
Write-Host "  webapp / webadmin  live now, nothing to restart"
Write-Host "  backend            needs deploy\stop.ps1 then deploy\start.ps1"
