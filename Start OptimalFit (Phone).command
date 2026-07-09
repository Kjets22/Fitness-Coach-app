#!/bin/zsh
# OptimalFit server launcher, PHONE MODE (macOS). Double-click to start.
# First time only: macOS Gatekeeper may block it — right-click -> Open once.
cd "$(dirname "$0")"
echo "Starting OptimalFit in PHONE MODE... (keep this window open - it IS the server)"
echo "Your phone must be on the same WiFi as this Mac."
python3 serve.py --phone --open
echo
echo "Server stopped. If it exited immediately, make sure Python 3 is installed"
echo "(run: xcode-select --install  or get it from https://www.python.org/downloads/)."
read -s -k 1 "?Press any key to close."
