# Creates the Cloudflare Tunnel that puts this machine on phaphak.com, and
# points the DNS at it.
#
# Run once, after `cloudflared tunnel login` — that step opens a browser and so
# cannot be scripted. Re-running is safe: an existing tunnel is reused and
# `route dns` overwrites the record it wrote last time.
#
# What this does NOT do is start anything. See start.ps1.

$ErrorActionPreference = 'Stop'

$TunnelName = 'laostay'
$Origin     = 'http://localhost:3100'
# phaphak.com is the guest site; admin.phaphak.com is WebAdmin. Which one a
# request gets is decided by the backend from the Host header — ADMIN_HOST in
# backend/.env — so both hostnames point at the same origin here.
$Hostnames  = @('phaphak.com', 'www.phaphak.com', 'admin.phaphak.com')

$CfDir = Join-Path $env:USERPROFILE '.cloudflared'
$Cert  = Join-Path $CfDir 'cert.pem'

if (-not (Test-Path $Cert)) {
  throw "No cert.pem in $CfDir. Run 'cloudflared tunnel login' first, pick phaphak.com in the browser, then run this again."
}

# ── The tunnel ───────────────────────────────────────────────────────────────
$existing = & cloudflared tunnel list --output json | ConvertFrom-Json |
  Where-Object { $_.name -eq $TunnelName }

if ($existing) {
  Write-Host "Tunnel '$TunnelName' already exists ($($existing.id))"
  $id = $existing.id
} else {
  & cloudflared tunnel create $TunnelName
  if ($LASTEXITCODE -ne 0) { throw "cloudflared tunnel create failed" }
  $id = (& cloudflared tunnel list --output json | ConvertFrom-Json |
    Where-Object { $_.name -eq $TunnelName }).id
  Write-Host "Created tunnel '$TunnelName' ($id)"
}

$credentials = Join-Path $CfDir "$id.json"
if (-not (Test-Path $credentials)) { throw "Credentials file not found: $credentials" }

# ── config.yml ───────────────────────────────────────────────────────────────
# The last rule is the catch-all cloudflared requires. Without it any hostname
# that reaches this tunnel without matching above would be an error at startup,
# not a 404.
$rules = ($Hostnames | ForEach-Object { "  - hostname: $_`n    service: $Origin" }) -join "`n"

$config = @"
# Written by deploy/tunnel-setup.ps1 — edit there, not here.
tunnel: $id
credentials-file: $credentials

# Both sites and the API are one origin on purpose: the SPAs call /api by
# relative path and the database stores photo URLs as /uploads/<key>, so they
# have to be answered by whatever host the browser is already on.
ingress:
$rules
  - service: http_status:404
"@

$configPath = Join-Path $CfDir 'config.yml'
# Written without a byte-order mark on purpose. `Out-File -Encoding utf8` on
# Windows PowerShell 5.1 emits one, and cloudflared's YAML parser reads it as
# part of the first key and cannot find `tunnel:`.
[System.IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $configPath"

& cloudflared tunnel ingress validate
if ($LASTEXITCODE -ne 0) { throw "ingress validation failed" }

# ── DNS ──────────────────────────────────────────────────────────────────────
# Each of these becomes a proxied CNAME to <id>.cfargotunnel.com in the
# phaphak.com zone.
foreach ($h in $Hostnames) {
  Write-Host "Routing $h -> $TunnelName"
  & cloudflared tunnel route dns --overwrite-dns $TunnelName $h
  if ($LASTEXITCODE -ne 0) { throw "route dns failed for $h" }
}

Write-Host ""
Write-Host "Done. Next: deploy\start.ps1"
