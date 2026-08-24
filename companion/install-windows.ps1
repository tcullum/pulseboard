$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$companionPath = Join-Path $scriptDir "pulseboard-telemetry.mjs"
$node = Get-Command node -ErrorAction Stop
$configDir = Join-Path $env:APPDATA "Pulseboard"
$configPath = Join-Path $configDir "relay.json"
$launcherPath = Join-Path $configDir "launch-hidden.vbs"
$logDir = Join-Path $env:LOCALAPPDATA "Pulseboard\Logs"
$taskName = "Pulseboard Companion"
$relayUrl = if ($env:PULSEBOARD_RELAY_URL) { $env:PULSEBOARD_RELAY_URL } else { "https://pulse.cullum.dad" }

New-Item -ItemType Directory -Force -Path $configDir, $logDir | Out-Null

if ($env:PULSEBOARD_RELAY_TOKEN -or $env:PULSEBOARD_SIWC_TOKEN -or $env:PLEX_TOKEN -or $env:PLEX_URL) {
  $config = @{}
  if (Test-Path $configPath) {
    $existing = Get-Content -Raw -Path $configPath | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($existing) {
      $existing.PSObject.Properties | ForEach-Object { $config[$_.Name] = $_.Value }
    }
  }
  if ($env:PULSEBOARD_RELAY_TOKEN -and $env:PULSEBOARD_SIWC_TOKEN) {
    $config["relayUrl"] = $relayUrl
    $config["deviceToken"] = $env:PULSEBOARD_RELAY_TOKEN
    $config["siwcToken"] = $env:PULSEBOARD_SIWC_TOKEN
  }
  if ($env:PLEX_TOKEN) { $config["plexToken"] = $env:PLEX_TOKEN }
  if ($env:PLEX_URL) { $config["plexUrl"] = $env:PLEX_URL }
  $configJson = $config | ConvertTo-Json -Depth 4
  Set-Content -Path $configPath -Value $configJson -Encoding UTF8
}

$launcher = @"
Option Explicit
Dim shell, command
Set shell = CreateObject("WScript.Shell")
command = """" & "$($node.Source)" & """" & " " & """" & "$companionPath" & """"
WScript.Quit shell.Run(command, 0, True)
"@
Set-Content -Path $launcherPath -Value $launcher -Encoding ASCII

$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "//B //Nologo `"$launcherPath`"" -WorkingDirectory $scriptDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Runs the Pulseboard Windows/Plex telemetry companion." -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Pulseboard Companion is installed and running."
