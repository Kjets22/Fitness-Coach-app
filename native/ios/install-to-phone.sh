#!/bin/bash
# ============================================================
# install-to-phone.sh — the ONE command to put OptimalFit on the iPhone.
#
#   1. plug the iPhone in with a cable and UNLOCK it
#   2. run:  ./native/ios/install-to-phone.sh
#
# It refreshes the web bundle (the step Xcode's Run button SKIPS — building
# from Xcode alone ships stale JS), reads the version/build straight from
# app/js/util.js so the number on the phone always matches the code, builds,
# and does a clean uninstall+install so iOS never rejects it as a downgrade.
# ============================================================
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
DEVID="B59C5846-E13E-558E-A013-3FD5640484A1"   # Krish's iPhone 17 ("Phone 11")
NATIVE="/Users/krishjetly/Fitness-Coach-app/native"
APPDIR="$NATIVE/ios/App"
DD="$HOME/Library/Caches/optimalfit-derived-data"   # stable, survives reboots
TEAM="F62L7PL2GA"                                    # the PAID team — never the personal one

# --- phone reachable? ---
if ! xcrun devicectl list devices 2>/dev/null | grep "$DEVID" | grep -qiv unavailable; then
  echo "!! iPhone not found. Plug it in with the cable, unlock it, tap 'Trust' if asked, then re-run."
  exit 1
fi

# --- version/build come from the app source (single source of truth) ---
VLINE=$(grep 'OF.APP_VERSION' /Users/krishjetly/Fitness-Coach-app/app/js/util.js)
MARKETING=$(echo "$VLINE" | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+).*/\1/')
BUILD=$(echo "$VLINE" | sed -E 's/.*build ([0-9]+).*/\1/')
[ -n "$MARKETING" ] && [ -n "$BUILD" ] || { echo "!! could not parse version from app/js/util.js"; exit 1; }
echo ">> shipping version $MARKETING (build $BUILD)"

echo ">> refreshing web bundle…"
# fail LOUD if the web bundle can't refresh — a silent failure here ships a
# stale app (this is the bug that made "no changes appear" on the phone).
( cd "$NATIVE" && node scripts/copy-web.js && npx cap sync ios ) || { echo "!! web sync FAILED — aborting so we never ship a stale bundle"; exit 1; }
# prove the bundle matches source before building
for f in exercise.js coach-intake.js food.js app.js util.js; do
  [ "$(md5 -q "$NATIVE/../app/js/$f")" = "$(md5 -q "$APPDIR/App/public/js/$f")" ] || { echo "!! $f STALE after sync — aborting"; exit 1; }
done

echo ">> building for device (team $TEAM)…"
cd "$APPDIR"
xcodebuild -project App.xcodeproj -scheme App \
  -destination "id=$DEVID" -derivedDataPath "$DD" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  MARKETING_VERSION="$MARKETING" CURRENT_PROJECT_VERSION="$BUILD" \
  build

APP=$(/usr/bin/find "$DD/Build/Products" -maxdepth 2 -name "App.app" -path "*iphoneos*" | head -1)
[ -n "$APP" ] || { echo "!! built app not found under $DD"; exit 1; }
grep -q "build $BUILD" "$APP/public/js/util.js" || { echo "!! bundle/build mismatch — aborting"; exit 1; }

echo ">> clean install → phone (uninstall old copy first, so iOS never sees a downgrade)"
xcrun devicectl device uninstall app --device "$DEVID" com.optimalfit.app >/dev/null 2>&1 || true
xcrun devicectl device install app --device "$DEVID" "$APP"
xcrun devicectl device process launch --device "$DEVID" com.optimalfit.app >/dev/null 2>&1 \
  && echo ">> launched on the phone" \
  || echo ">> installed. (Couldn't auto-open — the phone is probably locked. Just tap the OptimalFit icon.)"
echo ">> DONE — version $MARKETING (build $BUILD) is on the phone. Check Community next to your username."
