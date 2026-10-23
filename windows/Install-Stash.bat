@echo off
title Install Stash
echo.
echo   Installing Stash. This window stays open - leave it until it says it is done.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'stash-bootstrap.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/dannyzeemedia/stash/main/windows/bootstrap.ps1' -OutFile $p; & $p } catch { Write-Host ''; Write-Host ('Could not start the installer: ' + $_.Exception.Message) -ForegroundColor Red; Write-Host 'Send this message to Danny.' }"
echo.
echo   ----------------------------------------------------------------
echo   If anything above is red, send a photo of this window to Danny.
echo   ----------------------------------------------------------------
echo.
pause
