@echo off
rem Updates CleanStream: gets the newest from GitHub and puts it in this folder (the extension
rem folder Chrome loads). Chrome notices within a minute and CleanStream reloads itself.
rem Also puts an "Update CleanStream" icon on the desktop, so next time it's one double-click.
rem It runs from a copy in TEMP, since this very file is replaced while it updates.
if /i not "%~1"=="--from-temp" (
  copy /y "%~f0" "%TEMP%\cleanstream-update.cmd" >nul
  "%TEMP%\cleanstream-update.cmd" --from-temp "%~dp0."
)
title Update CleanStream
set "CS_EXT=%~f2"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$ext = $env:CS_EXT;" ^
  "$tmp = Join-Path $env:TEMP ('cleanstream-update-' + [guid]::NewGuid());" ^
  "try {" ^
  "  Write-Host 'Getting the newest CleanStream...';" ^
  "  New-Item -ItemType Directory $tmp | Out-Null;" ^
  "  [Net.ServicePointManager]::SecurityProtocol = 'Tls12';" ^
  "  Invoke-WebRequest 'https://github.com/BookWorm824/cleanstream/archive/refs/heads/main.zip' -OutFile (Join-Path $tmp 'cs.zip') -UseBasicParsing;" ^
  "  Expand-Archive (Join-Path $tmp 'cs.zip') (Join-Path $tmp 'x');" ^
  "  $new = Get-ChildItem (Join-Path $tmp 'x') -Directory | Select-Object -First 1;" ^
  "  $newExt = Join-Path $new.FullName 'extension';" ^
  "  $m = Get-Content (Join-Path $newExt 'manifest.json') -Raw | ConvertFrom-Json;" ^
  "  if (-not $m.version) { throw 'The download looks broken.' }" ^
  "  robocopy $newExt $ext /MIR /NFL /NDL /NJH /NJS /NP | Out-Null;" ^
  "  if ($LASTEXITCODE -ge 8) { throw 'The new files could not be copied.' }" ^
  "  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Update CleanStream.lnk';" ^
  "  $had = Test-Path $lnk;" ^
  "  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk);" ^
  "  $s.TargetPath = Join-Path $ext 'update.cmd'; $s.WorkingDirectory = $ext;" ^
  "  $s.IconLocation = (Join-Path $ext 'icons\cleanstream.ico') + ',0';" ^
  "  $s.Description = 'Gets the newest CleanStream'; $s.Save();" ^
  "  Write-Host '';" ^
  "  Write-Host ('Done: CleanStream ' + $m.version + ' is ready.');" ^
  "  Write-Host 'Chrome picks it up within a minute. Then press F5 on any YouTube page.';" ^
  "  if (-not $had) { Write-Host ''; Write-Host 'Next time, just double-click Update CleanStream on your desktop.' }" ^
  "} catch {" ^
  "  Write-Host '';" ^
  "  Write-Host ('CleanStream could not be updated: ' + $_.Exception.Message);" ^
  "  Write-Host 'Check the internet connection and try again.';" ^
  "} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }"
echo.
pause
exit
