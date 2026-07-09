#!/bin/zsh
# OptimalFit server launcher (macOS). Double-click to start.
# First time only: macOS Gatekeeper may block it — right-click -> Open once.
cd "$(dirname "$0")"
echo "Starting OptimalFit... (keep this window open - it IS the server)"
python3 serve.py --open
echo
echo "Server stopped. If it exited immediately, make sure Python 3 is installed"
echo "(run: xcode-select --install  or get it from https://www.python.org/downloads/)."
read -s -k 1 "?Press any key to close."
