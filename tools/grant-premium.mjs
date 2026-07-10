#!/usr/bin/env node
/*
 * grant-premium.mjs — the OWNER's tool to unlock the paywalled AI features
 * (Coach, food-photo macros, physique analysis) for any account.
 *
 * Reads the Supabase SERVICE key from the gitignored .env.supabase, so it can
 * set entitlements that regular users can never set themselves. This script
 * contains no secrets and is safe to commit.
 *
 * Usage (from the repo root):
 *   set -a; source .env.supabase; set +a
 *   node tools/grant-premium.mjs <username> premium       # grant premium
 *   node tools/grant-premium.mjs <username> premium off   # revoke premium
 *   node tools/grant-premium.mjs <username> admin          # make an owner/admin (also premium)
 *   node tools/grant-premium.mjs <username> admin off      # revoke admin
 *   node tools/grant-premium.mjs --list                    # show premium/admin accounts
 */
const URL = process.env.SUPABASE_URL;
const SRV = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SRV) { console.error('Run: set -a; source .env.supabase; set +a  (missing SUPABASE_URL / SERVICE key)'); process.exit(1); }

const H = { apikey: SRV, Authorization: 'Bearer ' + SRV, 'Content-Type': 'application/json' };

async function rest(method, path, body) {
  const r = await fetch(URL + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

const [arg1, arg2, arg3] = process.argv.slice(2);

if (arg1 === '--list' || !arg1) {
  const rows = await rest('GET', '/rest/v1/profiles?select=username,is_premium,is_admin&or=(is_premium.eq.true,is_admin.eq.true)&order=is_admin.desc');
  if (!rows.length) { console.log('No premium/admin accounts yet.'); }
  else { console.log('username            premium  admin'); rows.forEach(r => console.log(`${(r.username||'').padEnd(20)}${String(!!r.is_premium).padEnd(9)}${!!r.is_admin}`)); }
  if (!arg1) console.log('\nUsage: node tools/grant-premium.mjs <username> premium|admin [off]');
  process.exit(0);
}

const kind = (arg2 || 'premium').toLowerCase();       // "premium" | "admin"
const on = (arg3 || 'on').toLowerCase() !== 'off';    // default on
if (!['premium', 'admin'].includes(kind)) { console.error('Second arg must be "premium" or "admin".'); process.exit(1); }

const found = await rest('GET', `/rest/v1/profiles?select=id,username,is_premium,is_admin&username=eq.${encodeURIComponent(arg1)}`);
if (!found.length) { console.error(`No account with username "${arg1}".`); process.exit(1); }
const u = found[0];

// admin implies premium; toggling premium leaves admin as-is
const body = kind === 'admin'
  ? { p_target: u.id, p_premium: on ? true : u.is_premium, p_admin: on }
  : { p_target: u.id, p_premium: on, p_admin: null };

await rest('POST', '/rest/v1/rpc/admin_set_premium', body);
const after = (await rest('GET', `/rest/v1/profiles?select=username,is_premium,is_admin&id=eq.${u.id}`))[0];
console.log(`OK  @${after.username}  premium=${after.is_premium}  admin=${after.is_admin}`);
