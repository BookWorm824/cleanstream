@echo off
rem Copyright (c) 2026 BookWorm824. All rights reserved. See LICENSE.
rem Installs CleanStreams listening helper for this Windows user (no admin rights): copies it to
rem %LOCALAPPDATA%\CleanStream Helper and tells Chrome and Edge where it is. It uses CleanViews
rem Python and speech model, so CleanView must be installed; nothing is downloaded.
title Install CleanStream listening helper
if not exist "%LOCALAPPDATA%\CleanView\venv\Scripts\python.exe" (
  echo CleanView is not installed on this PC, so the listening helper cant work here.
  pause
  exit /b 1
)
set "H=%LOCALAPPDATA%\CleanStream Helper"
if not exist "%H%" mkdir "%H%"
copy /y "%~dp0listen_host.py" "%H%\" >nul
copy /y "%~dp0listen_host.bat" "%H%\" >nul
copy /y "%~dp0com.cleanstream.listen.json" "%H%\" >nul
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cleanstream.listen" /ve /t REG_SZ /d "%H%\com.cleanstream.listen.json" /f >nul
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.cleanstream.listen" /ve /t REG_SZ /d "%H%\com.cleanstream.listen.json" /f >nul
echo installed> "%H%\installed.txt"
echo CleanStreams listening helper is installed.
timeout /t 2 >nul
