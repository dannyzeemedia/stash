# Installs Stash. Downloads the app, sets it up, keeps it running, keeps it
# updated. Safe to run again any time - it never touches your board.
$ErrorActionPreference = "Stop"

$Repo    = "dannyzeemedia/stash"
$Root    = Join-Path $env:LOCALAPPDATA "Stash"
$ZipUrl  = "https://github.com/$Repo/archive/refs/heads/main.zip"
$ApiUrl  = "https://api.github.com/repos/$Repo/commits/main"

function Say($m, $c = "Gray") { Write-Host $m -ForegroundColor $c }

Say ""
Say "  Stash" Cyan
Say "  a bookmark board that lives on this computer"
Say ""

# --- Python -----------------------------------------------------------------
$py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $py) {
  Say "Python isn't here yet. Installing it..." Yellow
  $winget = (Get-Command winget.exe -ErrorAction SilentlyContinue).Source
  if ($winget) {
    & winget install --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    $py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
  }
  if (-not $py) {
    Say "Couldn't install Python automatically." Red
    Say "Get it from https://www.python.org/downloads/ - tick 'Add python.exe to PATH' -"
    Say "then run this installer again."
    Read-Host "Press Enter to close"
    exit 1
  }
}
Say "Python: $py"

# --- the app ----------------------------------------------------------------
Say "Downloading Stash..."
$tmp = Join-Path $env:TEMP ("stash-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp "stash.zip"
Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$src = Join-Path $tmp "stash-main"

New-Item -ItemType Directory -Force -Path $Root | Out-Null
# Only code is replaced. hub.json, icons, backups and logs are yours and stay.
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
try {
  $sha = (Invoke-RestMethod -Uri $ApiUrl -UseBasicParsing).sha
  Set-Content -Path (Join-Path $Root ".version") -Value $sha
} catch { }
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Say "Installed to $Root"

# --- what it needs ----------------------------------------------------------
Say "Installing what it needs..."
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r (Join-Path $Root "requirements.txt")

# --- keep it running, keep it current ---------------------------------------
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$serve = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\windows\serve.ps1`""
$atLogon = New-ScheduledTaskTrigger -AtLogOn
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
Unregister-ScheduledTask -TaskName "Stash" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Stash" -Action $serve -Trigger @($atLogon, $every5) `
  -Settings $settings -Description "Keeps Stash running" | Out-Null

$upd = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\windows\update.ps1`" -Quiet"
$daily = New-ScheduledTaskTrigger -Daily -At 7am
Unregister-ScheduledTask -TaskName "Stash Update" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "Stash Update" -Action $upd -Trigger @($daily, $atLogon) `
  -Settings $settings -Description "Keeps Stash up to date" | Out-Null
Say "It will start with Windows and update itself."

# --- start it ---------------------------------------------------------------
& "$Root\windows\serve.ps1"
Start-Sleep -Seconds 5
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:8800/api/board" -TimeoutSec 6 -UseBasicParsing | Out-Null
  Say ""
  Say "  Stash is running: http://localhost:8800" Green
} catch {
  Say "Stash didn't come up. Look in $Root\logs\server.log" Red
  Read-Host "Press Enter to close"
  exit 1
}

# --- shortcut ---------------------------------------------------------------
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Stash.lnk"
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = "http://localhost:8800"
$sc.Save()

Say ""
Say "  One last thing, in your browser:" Cyan
Say "    1. Open  brave://extensions   (or chrome://extensions)"
Say "    2. Turn on Developer mode, top right"
Say "    3. Click Load unpacked, and choose:"
Say "       $Root\extension" White
Say ""
Say "  Then every new tab is your board, and Ctrl+Shift+S saves the page you're on."
Say ""
Read-Host "Press Enter to close"
