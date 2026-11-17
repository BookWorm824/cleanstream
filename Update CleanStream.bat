@echo off
rem Gets the newest CleanStream from GitHub and puts it in the "extension" folder beside this
rem file. Chrome notices within a minute and CleanStream reloads itself; then press F5 on YouTube.
title Update CleanStream
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$here = '%~dp0'.TrimEnd('\');" ^
  "$ext = Join-Path $here 'extension';" ^
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
  "  Write-Host '';" ^
  "  Write-Host ('Done: CleanStream ' + $m.version + ' is ready.');" ^
  "  Write-Host 'Chrome picks it up within a minute. Then press F5 on any YouTube page.';" ^
  "} catch {" ^
  "  Write-Host '';" ^
  "  Write-Host ('CleanStream could not be updated: ' + $_.Exception.Message);" ^
  "  Write-Host 'Check the internet connection and try again.';" ^
  "} finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }"
echo.
pause
