@echo off
title OptimalFit server
rem Run from the folder this script lives in
cd /d "%~dp0"
echo Starting OptimalFit... (keep this window open - it IS the server)
python serve.py --open
echo.
echo Server stopped. If it exited immediately, make sure Python 3 is installed
echo and on your PATH (https://www.python.org/downloads/).
pause
