#!/bin/bash
# OptimalFit coach server (public mode) — run by launchd at login.
# Reads the tunnel host + access key from the gitignored .env.coach.
cd "$(dirname "$0")/.."
set -a; source .env.coach; set +a
exec /usr/bin/python3 serve.py
