@echo off
rem Copyright (c) 2026 BookWorm824. All rights reserved. See LICENSE.
rem Sets up CleanStreams listening helper for this Windows user (no admin rights). "Update
rem CleanStream" does this by itself after each update when CleanView is installed; this is the
rem same thing by hand (extension\helper\setup.ps1). Nothing is downloaded.
title Install CleanStream listening helper
for /f "delims=" %%r in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\extension\helper\setup.ps1"') do set "R=%%r"
if "%R%"=="set up" (
  echo CleanStreams listening helper is installed.
  timeout /t 2 >nul
) else (
  echo CleanView is not installed on this PC, so the listening helper cant work here.
  pause
)
