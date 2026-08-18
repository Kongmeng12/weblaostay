# Takes a backup of the database and the uploaded photos, appending to a log.
#
# Meant to be run by the "LaoStay Backup" scheduled task as well as by hand.
# The scheduled task has nowhere to print, so everything goes to
# deploy\logs\backup.log and the exit code is preserved for the task history.
#
#   .\deploy\backup.ps1
#   .\deploy\backup.ps1 -Out E:\offsite\laostay
#
# Read-only against the database. The one thing it deletes is its own output
# older than a fortnight; see KEEP_DAYS in backend\scripts\backup-db.mjs.

param([string]$Out)

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$logs    = Join-Path $PSScriptRoot 'logs'
$log     = Join-Path $logs 'backup.log'

if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Force $logs | Out-Null }

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $log -Value "`n===== $stamp =====" -Encoding utf8

$nodeArgs = @('scripts/backup-db.mjs')
if ($Out) { $nodeArgs += @('--out', $Out) }

$captured = New-Object System.Collections.Generic.List[string]

Push-Location $backend
try {
  # stderr is folded into stdout so a failure explains itself in the same log
  # rather than vanishing into a task-scheduler exit code.
  #
  # ErrorActionPreference has to drop to Continue across this one call.
  # PowerShell 5.1 wraps every stderr line from a native exe in an ErrorRecord,
  # so under 'Stop' one harmless warning on stderr aborts the script even
  # though node exited 0. The real result is $LASTEXITCODE, checked below.
  #
  # Collected rather than Tee-Object'd: Tee-Object has no -Encoding before
  # PowerShell 6 and writes UTF-16, which against a UTF-8 header leaves a log
  # half of which Get-Content renders as NUL-separated gibberish.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & node @nodeArgs 2>&1 | ForEach-Object {
    $line = $_.ToString()
    Write-Host $line
    $captured.Add($line)
  }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
} finally {
  Pop-Location
}

if ($captured.Count) { Add-Content -Path $log -Value $captured -Encoding utf8 }

if ($code -ne 0) {
  Add-Content -Path $log -Value "FAILED with exit code $code" -Encoding utf8
  Write-Error "Backup failed — see $log"
  exit $code
}

# Keep the log from growing without bound. 2000 lines is roughly a year of
# daily runs at this table count.
$lines = Get-Content $log
if ($lines.Count -gt 2000) {
  $lines | Select-Object -Last 1500 | Set-Content -Path $log -Encoding utf8
}
