#!/bin/bash
# OptimalFit coach server (public mode) — run by launchd at login.
# Reads the tunnel host + access key from the gitignored .env.coach.
cd "$(dirname "$0")/.."
set -a; source .env.coach; set +a
# caffeinate -s: keep the Mac from SLEEPING while the server runs, but ONLY
# on AC power (no effect on battery). A sleeping Mac was the #1 cause of the
# phone's coach/photo features being unreachable.
exec /usr/bin/caffeinate -s /usr/bin/python3 serve.py
