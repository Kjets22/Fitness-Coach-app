// Make capacitor-health-extended iOS-only: its Android (Health Connect) source
// doesn't compile against any resolvable connect-client version, and this app
// ships Android without Health sync. Strip the plugin's Android declaration so
// `cap sync` skips it on Android. Runs on postinstall (survives npm install).
const fs = require('fs');
const pj = 'node_modules/@flomentumsolutions/capacitor-health-extended/package.json';
try {
  const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
  if (p.capacitor && p.capacitor.android) { delete p.capacitor.android; fs.writeFileSync(pj, JSON.stringify(p, null, 2) + '\n'); }
  console.log('capacitor-health-extended: android support stripped (iOS-only)');
} catch (e) { /* plugin not installed — nothing to do */ }
