@echo off
title Install Stash
echo.
echo   Installing Stash. Leave this window open until it says it is done.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $src = (New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/dannyzeemedia/stash/main/windows/bootstrap.ps1'); Invoke-Expression $src } catch { Write-Host ''; Write-Host '---- it stopped here ----' -ForegroundColor Red; Write-Host ('Problem : ' + $_.Exception.Message) -ForegroundColor Red; Write-Host ('Type    : ' + $_.Exception.GetType().FullName); Write-Host ('Where   : ' + $_.InvocationInfo.Line.Trim()); Write-Host ''; Write-Host 'Script rules on this computer:'; Get-ExecutionPolicy -List | Format-Table -AutoSize | Out-String | Write-Host; Write-Host ('PowerShell : ' + $PSVersionTable.PSVersion); Write-Host ('User       : ' + $env:USERNAME); Write-Host ''; Write-Host 'Send a photo of this window to Danny.' -ForegroundColor Yellow }"
echo.
echo   ----------------------------------------------------------------
echo   If there is red text above, send a photo of this window to Danny.
echo   ----------------------------------------------------------------
echo.
pause
