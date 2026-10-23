# Checks GitHub for a newer Stash and installs it. Runs daily and at logon.
# Only code is replaced - your board, logos and history are never touched.
param([switch]$Quiet)
$ErrorActionPreference = "Stop"

$Repo   = "dannyzeemedia/stash"
$Root   = Join-Path $env:LOCALAPPDATA "Stash"
$ZipUrl = "https://github.com/$Repo/archive/refs/heads/main.zip"
$ApiUrl = "https://api.github.com/repos/$Repo/commits/main"
$marker = Join-Path $Root ".version"

New-Item -ItemType Directory -Force -Path "$Root\logs" | Out-Null
function Note($m) {
  Add-Content "$Root\logs\update.log" ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $m)
  if (-not $Quiet) { Write-Host $m }
}

try {
  $latest = (Invoke-RestMethod -Uri $ApiUrl -UseBasicParsing -TimeoutSec 20).sha
} catch {
  Note "Couldn't reach GitHub - will try again next time."
  if (-not $Quiet) { Read-Host "Press Enter to close" }
  exit 0
}

$have = ""
if (Test-Path $marker) { $have = (Get-Content $marker -Raw).Trim() }
if ($have -eq $latest) {
  Note "Already up to date."
  if (-not $Quiet) { Read-Host "Press Enter to close" }
  exit 0
}

Note "A newer version is available. Updating..."
$tmp = Join-Path $env:TEMP ("stash-up-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp "stash.zip"
  Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $src = Join-Path $tmp "stash-main"

  # Replace code wholesale so nothing stale lingers, but never the data
  # directories. "windows" is merged rather than replaced, because this script is
  # running from inside it.
  foreach ($item in @("static", "extension", "tools")) {
    $from = Join-Path $src $item
    if (Test-Path $from) {
      Remove-Item -Recurse -Force (Join-Path $Root $item) -ErrorAction SilentlyContinue
      Copy-Item -Path $from -Destination $Root -Recurse -Force
    }
  }
  foreach ($item in @("server.py", "requirements.txt")) {
    $from = Join-Path $src $item
    if (Test-Path $from) { Copy-Item -Path $from -Destination $Root -Force }
  }
  $winFrom = Join-Path $src "windows"
  if (Test-Path $winFrom) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root "windows") | Out-Null
    Copy-Item -Path (Join-Path $winFrom "*") -Destination (Join-Path $Root "windows") -Recurse -Force
  }

  $py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
  if ($py) { & $py -m pip install --quiet -r (Join-Path $Root "requirements.txt") }

  Set-Content -Path $marker -Value $latest

  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" |
    Where-Object { $_.CommandLine -like "*server.py*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  & "$Root\windows\serve.ps1"

  Note "Updated to $($latest.Substring(0,7)) and restarted."
} catch {
  Note "Update failed: $($_.Exception.Message)"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

if (-not $Quiet) { Read-Host "Press Enter to close" }
