# One-time setup for Stash on Windows. Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File windows\install.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Stash setup" -ForegroundColor Cyan

$py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $py) {
  Write-Host "Python isn't installed. Get it from https://www.python.org/downloads/ " -ForegroundColor Yellow
  Write-Host "and tick 'Add python.exe to PATH' during setup, then run this again."
  exit 1
}
Write-Host "Python: $py"

Write-Host "Installing what it needs..."
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r "$root\requirements.txt"

# Keep it running: at logon, and a check every 5 minutes that does nothing if
# it is already up.
$task = "Stash"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\windows\serve.ps1`""
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $task -Action $action -Trigger @($atLogon, $every5) `
  -Settings $settings -Description "Keeps the Stash bookmark board running" | Out-Null
Write-Host "Scheduled task '$task' registered (at logon, checked every 5 minutes)."

# Pick up improvements automatically: a quiet pull once a day.
$upTask = "Stash Update"
$upAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\windows\update.ps1`""
$daily = New-ScheduledTaskTrigger -Daily -At 7am
Unregister-ScheduledTask -TaskName $upTask -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $upTask -Action $upAction -Trigger $daily `
  -Settings $settings -Description "Pulls the latest Stash each morning" | Out-Null
Write-Host "Scheduled task '$upTask' registered (daily at 7am)."

& "$root\windows\serve.ps1"
Start-Sleep -Seconds 4
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:8800/api/board" -TimeoutSec 5 -UseBasicParsing | Out-Null
  Write-Host "Stash is running at http://localhost:8800" -ForegroundColor Green
} catch {
  Write-Host "Stash did not come up. See logs\server.log" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "Last step, in your browser:" -ForegroundColor Cyan
Write-Host "  1. Open  brave://extensions   (or chrome://extensions)"
Write-Host "  2. Turn on Developer mode"
Write-Host "  3. Load unpacked  ->  $root\extension"
Write-Host ""
Write-Host "Every new tab becomes your board, and Ctrl+Shift+S files the page you are on."
