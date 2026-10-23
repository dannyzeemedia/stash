# Pull the latest Stash and restart it. Your board, logos and history are not
# in the repo, so an update never touches them.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Checking for updates..."
git fetch --quiet origin
$behind = (git rev-list --count HEAD..origin/main)
if ($behind -eq "0") {
  Write-Host "Already up to date."
} else {
  git pull --ff-only origin main
  Write-Host "Updated ($behind change(s))."
  python -m pip install --quiet --upgrade -r requirements.txt
}

Get-Process python, pythonw -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -like "*server.py*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 2
& "$PSScriptRoot\serve.ps1"
Write-Host "Stash restarted. Reload the extension at brave://extensions if its version changed."
