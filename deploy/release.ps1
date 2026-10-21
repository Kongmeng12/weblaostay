# Deploys one committed version to the production folder, E:\phapai-prod.
#
#   .\deploy\release.ps1                     deploy origin/main
#   .\deploy\release.ps1 -Commit a8dd1e3     deploy (or roll back to) that commit
#
# Production used to run straight out of this checkout, sharing its
# node_modules with development. On 2026-10-21 a dev ran `prisma generate` for
# a new column whose migration had not been run yet, and every property page in
# production answered 500 — nothing was deployed, the shared Prisma client
# simply changed underneath the running API.
#
# So production is now its own git worktree (detached, never edited by hand)
# with its own node_modules, Prisma client, .env and uploads folder. Only this
# script changes it, and only to a commit:
#
#   1. checks out the commit there (refuses if someone edited files in it)
#   2. refuses if the database lacks a table or column that commit's schema
#      uses — the migration has to be run first (deploy\check-schema.js)
#   3. installs dependencies only when a package-lock.json changed
#   4. builds everything into dist-next folders while the old API keeps serving
#   5. stops the API, swaps the builds in, regenerates the Prisma client if the
#      schema or dependencies changed, starts it again (a few seconds down)
#
# Start and stop production with E:\phapai-prod\deploy\start.ps1 / stop.ps1.

param(
  [string]$Commit = 'origin/main',
  [string]$Prod = 'E:\phapai-prod'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$parts = @('backend', 'webapp', 'webadmin')

# Windows PowerShell turns a native command's stderr into an error under
# 'Stop' in some hosts, and git and npm both chat on stderr. Judge them by
# their exit code instead.
function Invoke-Native([string]$what, [scriptblock]$cmd) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $cmd 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Step([string]$text) { Write-Host ""; Write-Host "── $text" -ForegroundColor Cyan }

function Get-LockHash([string]$part) {
  (Get-FileHash -LiteralPath (Join-Path $Prod "$part\package-lock.json")).Hash
}
function Get-Stamp([string]$file) {
  if (Test-Path -LiteralPath $file) { (Get-Content -LiteralPath $file -Raw).Trim() } else { '' }
}

# ── 1. the commit ─────────────────────────────────────────────────────────────
Step "Commit"
Invoke-Native 'git fetch' { git -C $repo fetch origin --quiet }
$sha = (git -C $repo rev-parse --verify "$Commit^{commit}" 2>$null)
if (-not $sha) { throw "Unknown commit '$Commit'." }
$sha = $sha.Trim()
Write-Host "    $(git -C $repo log -1 --format='%h %s' $sha)"

$first = -not (Test-Path -LiteralPath $Prod)
$prevSha = $null
if ($first) {
  Invoke-Native 'git worktree add' { git -C $repo worktree add --detach $Prod $sha }
  Copy-Item -LiteralPath (Join-Path $repo 'backend\.env') -Destination (Join-Path $Prod 'backend\.env')
  Write-Host "    created $Prod and copied backend\.env into it"
} else {
  $dirty = git -C $Prod status --porcelain --untracked-files=no
  if ($dirty) { throw "$Prod has edited files — production is only ever changed by this script:`n$dirty" }
  $prevSha = (git -C $Prod rev-parse HEAD).Trim()
  Invoke-Native 'git checkout' { git -C $Prod checkout --quiet --detach $sha }
}
# start.ps1 refuses to run from any folder without this marker, so a dev
# checkout can no longer be started as production by mistake.
Set-Content -LiteralPath (Join-Path $Prod '.phapai-prod') -Value $sha -Encoding ascii

$prodEnv = Join-Path $Prod 'backend\.env'
if (-not (Test-Path -LiteralPath $prodEnv)) { throw "$prodEnv is missing." }
# Production keeps its own .env. A key that development has and production
# lacks is usually a new setting the new code reads — say so, change nothing.
$keys = { param($f) Get-Content -LiteralPath $f | Where-Object { $_ -match '^\s*([A-Z0-9_]+)\s*=' } | ForEach-Object { $Matches[1] } }
$newKeys = & $keys (Join-Path $repo 'backend\.env') | Where-Object { $_ -notin (& $keys $prodEnv) }
if ($newKeys) { Write-Host "    note: backend\.env here has keys production's .env lacks: $($newKeys -join ', ')" -ForegroundColor Yellow }

function Undo-Checkout {
  if ($prevSha) { git -C $Prod checkout --quiet --detach $prevSha 2>$null | Out-Null; Set-Content -LiteralPath (Join-Path $Prod '.phapai-prod') -Value $prevSha -Encoding ascii }
}

# ── 2. the database has what this schema needs ────────────────────────────────
Step "Database schema"
$schema = Join-Path $Prod 'backend\prisma\schema.prisma'
# Production's own node_modules once they exist; on the very first release
# the dev checkout's prisma CLI reads the same database.
$checkFrom = if (Test-Path -LiteralPath (Join-Path $Prod 'backend\node_modules\prisma')) { Join-Path $Prod 'backend' } else { Join-Path $repo 'backend' }
Push-Location -LiteralPath $checkFrom
try {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & node (Join-Path $PSScriptRoot 'check-schema.js') $schema 2>&1 | ForEach-Object { Write-Host "    $_" }
  $code = $LASTEXITCODE; $ErrorActionPreference = $prev
} finally { Pop-Location }
if ($code -ne 0) { Undo-Checkout; throw "Not deployed: the database is not ready for $($sha.Substring(0,7)) (see above). Production is unchanged." }

# ── 3. dependencies ───────────────────────────────────────────────────────────
Step "Dependencies"
$be = Join-Path $Prod 'backend'
# Once production has been released, whatever answers on 3100 is running out
# of $Prod\backend\node_modules and holds its Prisma engine open — Windows will
# not let npm or `prisma generate` replace that file until the API stops.
$engineLoaded = (-not $first) -and [bool](Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)
$backendDeps = $false
foreach ($p in $parts) {
  $stamp = Join-Path $Prod "$p\node_modules\.release-lock-hash"
  $hash = Get-LockHash $p
  if ((Get-Stamp $stamp) -eq $hash) { Write-Host "    $p unchanged"; continue }
  if ($p -eq 'backend' -and $engineLoaded) { $backendDeps = $true; Write-Host "    backend changed — installs once the API is stopped"; continue }
  Push-Location -LiteralPath (Join-Path $Prod $p)
  try { Invoke-Native "npm ci ($p)" { npm ci --no-audit --no-fund } } finally { Pop-Location }
  Set-Content -LiteralPath $stamp -Value $hash -Encoding ascii
}

$schemaStamp = Join-Path $be 'node_modules\.release-schema-hash'
$schemaHash = (Get-FileHash -LiteralPath $schema).Hash
$schemaChanged = (Get-Stamp $schemaStamp) -ne $schemaHash
function Update-PrismaClient {
  Push-Location -LiteralPath $be
  try { Invoke-Native 'prisma generate' { npx prisma generate } } finally { Pop-Location }
  Set-Content -LiteralPath $schemaStamp -Value $schemaHash -Encoding ascii
}
function Build-Backend {
  Push-Location -LiteralPath $be
  try {
    $next = Join-Path $be 'dist-next'
    if (Test-Path -LiteralPath $next) { Remove-Item -LiteralPath $next -Recurse -Force }
    Invoke-Native 'build (backend)' { npx tsc -p tsconfig.json --outDir dist-next --incremental false }
  } finally { Pop-Location }
}

# The backend is type-checked against the Prisma client, so a new schema needs
# its client first. If the running API holds that client, the API has to stop
# before the build instead of after it — a minute down rather than seconds.
$stopFirst = $backendDeps -or ($schemaChanged -and $engineLoaded)
if ($schemaChanged -and -not $stopFirst) { Update-PrismaClient }

# ── 4. build beside the live copies ───────────────────────────────────────────
Step "Build"
foreach ($p in 'webapp', 'webadmin') {
  Push-Location -LiteralPath (Join-Path $Prod $p)
  try { Invoke-Native "build ($p)" { npm run build -- --outDir dist-next --emptyOutDir } } finally { Pop-Location }
}
if (-not $stopFirst) { Build-Backend }

# ── 5. switch ─────────────────────────────────────────────────────────────────
Step "Switch"
foreach ($p in 'webapp', 'webadmin') {
  # Served straight off disk per request, so this is live the moment it lands.
  robocopy (Join-Path $Prod "$p\dist-next") (Join-Path $Prod "$p\dist") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copying $p failed (robocopy $LASTEXITCODE)" }
  Write-Host "    $p live"
}

& (Join-Path $Prod 'deploy\stop.ps1')

if ($stopFirst) {
  try {
    if ($backendDeps) {
      Push-Location -LiteralPath $be
      try { Invoke-Native 'npm ci (backend)' { npm ci --no-audit --no-fund } } finally { Pop-Location }
      Set-Content -LiteralPath (Join-Path $be 'node_modules\.release-lock-hash') -Value (Get-LockHash 'backend') -Encoding ascii
    }
    Update-PrismaClient
    Build-Backend
  } catch {
    # The old dist is still in place, and the schema check above means the
    # database has every column either build reads — bring the site back on
    # the old build rather than leave it down.
    Write-Host "    $_" -ForegroundColor Red
    Write-Host "    Build failed with the API stopped — starting the previous build again." -ForegroundColor Yellow
    & (Join-Path $Prod 'deploy\start.ps1')
    throw "Not deployed: the backend did not build. The previous build is serving."
  }
}

robocopy (Join-Path $be 'dist-next') (Join-Path $be 'dist') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copying backend failed (robocopy $LASTEXITCODE)" }

& (Join-Path $Prod 'deploy\start.ps1')

$log = Join-Path $Prod 'deploy\logs\releases.log'
Add-Content -LiteralPath $log -Value "$(Get-Date -Format s)  $sha  (was $(if ($prevSha) { $prevSha } else { 'first release' }))"
Write-Host ""
Write-Host "Released $($sha.Substring(0,7))." -ForegroundColor Green
if ($prevSha) { Write-Host "Roll back with: .\deploy\release.ps1 -Commit $($prevSha.Substring(0,7))" }
