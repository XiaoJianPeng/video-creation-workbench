@echo off
title Video Workbench - Local Data Service
set "NODE_EXE=C:\Users\89282\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo Starting local data service at http://127.0.0.1:8791/
echo Press Ctrl+C to stop.
"%NODE_EXE%" "%~dp0server.js"
pause
