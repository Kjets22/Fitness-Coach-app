@echo off
title OptimalFit server (phone mode)
rem Run from the folder this script lives in
cd /d "%~dp0"
echo Starting OptimalFit in PHONE MODE... (keep this window open - it IS the server)
echo Your phone must be on the same WiFi as this PC.
python serve.py --phone --open
echo.
echo Server stopped. If it exited immediately, make sure Python 3 is installed
echo and on your PATH (https://www.python.org/downloads/).
pause
