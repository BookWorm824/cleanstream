@echo off
rem Removes CleanStreams listening helper for this Windows user.
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cleanstream.listen" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.cleanstream.listen" /f >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\CleanStream Helper" 2>nul
echo CleanStreams listening helper is removed.
timeout /t 2 >nul
