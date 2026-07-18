$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$companionPath = Join-Path $scriptDir "pulseboard-telemetry.mjs"
$node = Get-Command node -ErrorAction Stop
$configDir = Join-Path $env:APPDATA "Pulseboard"
$configPath = Join-Path $configDir "relay.json"
$logDir = Join-Path $env:LOCALAPPDATA "Pulseboard\Logs"
$taskName = "Pulseboard Companion"

New-Item -ItemType Directory -Force -Path $configDir, $logDir | Out-Null

if ($env:PULSEBOARD_RELAY_TOKEN -and $env:PULSEBOARD_SIWC_TOKEN) {
  $config = @{
    relayUrl = "https://pulseboard-mac-monitor.rysingsun.chatgpt.site"
    deviceToken = $env:PULSEBOARD_RELAY_TOKEN
    siwcToken = $env:PULSEBOARD_SIWC_TOKEN
  } | ConvertTo-Json -Depth 3
  Set-Content -Path $configPath -Value $config -Encoding UTF8
}

$action = New-ScheduledTaskAction -Execute $node.Source -Argument "`"$companionPath`"" -WorkingDirectory $scriptDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Runs the Pulseboard Windows/Plex telemetry companion." -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Pulseboard Companion is installed and running."
