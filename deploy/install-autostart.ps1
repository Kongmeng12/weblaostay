# Registers the API and the tunnel as scheduled tasks so phaphak.com survives a
# reboot, and comes back on its own if either process dies.
#
# Two tasks rather than one, because they fail independently: the tunnel
# dropping is a network problem and the API dying is not, and a supervisor that
# restarts both together turns one fault into two outages.
#
# Runs without admin, which is why the trigger is at logon rather than at boot —
# a task that runs before anyone signs in needs stored credentials, and that
# needs elevation. The machine must therefore reach the desktop, not just the
# login screen. Set the account to sign in automatically if that is a problem.
#
# Undo with:  Unregister-ScheduledTask -TaskName 'LaoStay API','LaoStay Tunnel' -Confirm:$false

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$logs    = Join-Path $PSScriptRoot 'logs'

if (-not (Test-Path $logs)) { New-Item -ItemType Directory -Force $logs | Out-Null }
if (-not (Test-Path (Join-Path $backend 'dist\main.js'))) {
  throw "backend\dist is missing — run deploy\build.ps1 first."
}

$node = (Get-Command node).Source
$cfd  = (Get-Command cloudflared).Source

# ExecutionTimeLimit 0 = never kill it for running too long, which is the whole
# point. RestartCount is per-day and generous: a database that is briefly
# unreachable should not use up the retries and leave the site down until
# someone notices.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$tasks = @(
  @{
    Name = 'LaoStay API'
    Exe  = $node
    Args = 'dist/main'
    Dir  = $backend
  },
  @{
    Name = 'LaoStay Tunnel'
    Exe  = $cfd
    Args = 'tunnel run laostay'
    Dir  = $PSScriptRoot
  }
)

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute $t.Exe -Argument $t.Args -WorkingDirectory $t.Dir
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger `
    -Settings $settings -Description 'phaphak.com — see kong\deploy' -Force | Out-Null
  Write-Host "Registered task: $($t.Name)"
}

Write-Host ""
Write-Host "Both start at your next sign-in. To start them now without rebooting:" -ForegroundColor Green
Write-Host "  Start-ScheduledTask -TaskName 'LaoStay API'; Start-ScheduledTask -TaskName 'LaoStay Tunnel'"
