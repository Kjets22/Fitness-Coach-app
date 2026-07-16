#!/bin/bash
# funnel-watchdog.sh — keeps the OptimalFit coach server reachable FROM THE
# INTERNET, not just locally. Runs as a root LaunchDaemon every 3 minutes.
#
# Why this exists: `tailscale funnel status` can report "Funnel on" while the
# backhaul to Tailscale's ingress is dead (TCP connects, TLS stalls) — the
# phone then sees "Live coach offline" even though everything looks healthy
# on the Mac (happened 2026-07-16). launchd only keeps serve.py alive; nothing
# was checking the actual public path. This does, the way the phone does.
#
# Checks, in order:
#   1. local serve.py health   → if down, kickstart the coach LaunchAgent
#   2. PUBLIC reachability     → curl via the funnel ingress IP (--resolve
#      dodges the macOS loopback quirk where local curls to the tunnel fail)
#   3. two consecutive public failures → funnel reset + re-enable
#
# Logs: /var/log/optimalfit-funnel-watchdog.log (trimmed at ~500 lines)

HOST="optimalfit-coach.tail7869b9.ts.net"
PORT=8642
TS=/opt/homebrew/bin/tailscale
LOG=/var/log/optimalfit-funnel-watchdog.log
STATE=/var/run/optimalfit-funnel-fails
FALLBACK_IPS="209.177.145.192 209.177.145.97"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

# keep the log from growing forever
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
  tail -n 250 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# --- 1. local server health (launchd should keep it up; kick if not) ---
if ! curl -s --max-time 8 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok": true'; then
  log "LOCAL DOWN — kickstarting com.optimalfit.coach"
  launchctl kickstart -k gui/501/com.optimalfit.coach 2>> "$LOG"
  sleep 8
  if curl -s --max-time 8 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok": true'; then
    log "local server recovered after kickstart"
  else
    log "local server STILL DOWN after kickstart"
  fi
fi

# --- 2. public reachability, exactly the path the phone uses ---
IPS=$(dig +short "$HOST" @8.8.8.8 2>/dev/null | grep -E '^[0-9.]+$')
[ -z "$IPS" ] && IPS="$FALLBACK_IPS"

public_ok=0
for ip in $IPS; do
  if curl -s --max-time 15 --resolve "$HOST:443:$ip" "https://$HOST/api/health" | grep -q '"ok": true'; then
    public_ok=1
    break
  fi
done

if [ "$public_ok" = 1 ]; then
  # healthy: clear the failure counter, stay quiet (no log spam)
  rm -f "$STATE"
  exit 0
fi

# --- 3. public path down: require 2 consecutive failures before resetting ---
fails=$(cat "$STATE" 2>/dev/null || echo 0)
fails=$((fails + 1))
echo "$fails" > "$STATE"
log "PUBLIC UNREACHABLE (consecutive fail #$fails)"

if [ "$fails" -ge 2 ]; then
  log "resetting funnel"
  "$TS" funnel reset >> "$LOG" 2>&1
  sleep 2
  "$TS" funnel --bg "$PORT" >> "$LOG" 2>&1
  sleep 8
  for ip in $IPS; do
    if curl -s --max-time 15 --resolve "$HOST:443:$ip" "https://$HOST/api/health" | grep -q '"ok": true'; then
      log "RECOVERED after funnel reset"
      rm -f "$STATE"
      exit 0
    fi
  done
  log "still unreachable after reset — will retry next run"
fi
