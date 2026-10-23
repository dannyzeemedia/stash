# Keep Stash up on Windows. Starts it if it isn't answering; does nothing if it is.
# The scheduled task runs this at logon and every 5 minutes.
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:8800/api/board" -TimeoutSec 4 -UseBasicParsing
  if ($r.StatusCode -eq 200) { exit 0 }
} catch { }

New-Item -ItemType Directory -Force -Path "$root\logs" | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content "$root\logs\server.log" "=== starting $stamp ==="

# pythonw has no console window, so nothing flashes up.
$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source }
if (-not $py) {
  Add-Content "$root\logs\server.log" "Python not found on PATH"
  exit 1
}

Start-Process -FilePath $py -ArgumentList "`"$root\server.py`"" -WorkingDirectory $root -WindowStyle Hidden
