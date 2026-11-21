@echo off
rem Started by Chrome for CleanStream (native messaging). Uses CleanViews Python and speech model.
"%LOCALAPPDATA%\CleanView\venv\Scripts\python.exe" -u "%~dp0listen_host.py" %* 2>> "%~dp0helper.log"
