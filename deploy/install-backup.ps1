# Registers the nightly backup as a scheduled task.
#
# Separate from install-autostart.ps1 on purpose: those two tasks keep the site
# up and this one protects the data, so they are installed, inspected and
# removed independently. A backup that only runs when someone remembers is not
# a backup.
#
# Runs without admin, so the trigger fires at logon and again every day at
# 03:00. The logon trigger matters more than it looks: if the machine was off
# overnight the daily run never happened, and the site coming back up is
# exactly when you want a fresh copy of what survived.
#
# Undo with:  Unregister-ScheduledTask -TaskName 'LaoStay Backup' -Confirm:$false

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'backup.ps1'
$logs   = Join-Path $PSScriptRoot 'logs'

if (-not (Test-Path $script)) { throw "backup.ps1 is missing from $PSScriptRoot" }
if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Force $logs | Out-Null }

$action = New-ScheduledTaskAction `
  -Execute (Get-Command powershell.exe).Source `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $PSScriptRoot

# A backup that is still running an hour later has gone wrong; let the task
# host kill it rather than leaving it holding a connection overnight.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 3am),
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)

Register-ScheduledTask -TaskName 'LaoStay Backup' -Action $action -Trigger $triggers `
  -Settings $settings -Description 'phaphak.com nightly data backup — see kong\deploy' -Force | Out-Null

Write-Host "Registered task: LaoStay Backup (daily 03:00, and at sign-in)"
Write-Host ""
Write-Host "Run it now without waiting:" -ForegroundColor Green
Write-Host "  Start-ScheduledTask -TaskName 'LaoStay Backup'"
Write-Host "  Get-Content .\deploy\logs\backup.log -Tail 20"
