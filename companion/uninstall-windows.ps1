$ErrorActionPreference = "Stop"

$taskName = "Pulseboard Companion"
$configPath = Join-Path $env:APPDATA "Pulseboard\relay.json"
$launcherPath = Join-Path $env:APPDATA "Pulseboard\launch-hidden.vbs"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Remove-Item -Path $configPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $launcherPath -Force -ErrorAction SilentlyContinue
Write-Host "Pulseboard Companion has been removed."
