#!/bin/bash
# Build + install OptimalFit onto the connected iPhone. Uses the project's own
# team (F62L7PL2GA), which the signed-in Apple ID owns and already has a valid
# provisioning profile for. -allowProvisioningUpdates creates any missing cert.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
DEVID="B59C5846-E13E-558E-A013-3FD5640484A1"
NATIVE="/Users/krishjetly/Fitness-Coach-app/native"
APPDIR="$NATIVE/ios/App"
DD="/private/tmp/claude-501/-Users-krishjetly/76c3f8d5-b8a2-48cc-bb81-133a48fde3dc/scratchpad/dd-device"
TEAM="F62L7PL2GA"

echo ">> refreshing web bundle…"
# fail LOUD if the web bundle can't refresh — a silent failure here ships a
# stale app (this is the bug that made "no changes appear" on the phone).
( cd "$NATIVE" && node scripts/copy-web.js && npx cap sync ios ) || { echo "!! web sync FAILED — aborting so we never ship a stale bundle"; exit 1; }
# prove the bundle matches source before building
for f in exercise.js coach-intake.js food-db.js; do
  [ "$(md5 -q "$NATIVE/../app/js/$f")" = "$(md5 -q "$APPDIR/App/public/js/$f")" ] || { echo "!! $f STALE after sync — aborting"; exit 1; }
done

echo ">> building for device (team $TEAM)…"
cd "$APPDIR"
xcodebuild -project App.xcodeproj -scheme App \
  -destination "id=$DEVID" -derivedDataPath "$DD" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  clean build

APP=$(/usr/bin/find "$DD/Build/Products" -maxdepth 2 -name "App.app" -path "*iphoneos*" | head -1)
echo ">> installing $APP → phone"
xcrun devicectl device install app --device "$DEVID" "$APP"
echo ">> DONE"
