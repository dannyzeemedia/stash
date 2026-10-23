@echo off
title Install Stash
echo Fetching the installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/dannyzeemedia/stash/main/windows/bootstrap.ps1 -OutFile $env:TEMP\stash-bootstrap.ps1; & powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\stash-bootstrap.ps1"
