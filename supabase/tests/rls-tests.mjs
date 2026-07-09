#!/usr/bin/env node
// ============================================================
// OptimalFit Phase 3 — RLS / RPC proof tests.
// Plain fetch against PostgREST + GoTrue. No dependencies.
//
// Run from the repo root:
//   node supabase/tests/rls-tests.mjs
// Requires gitignored env files: .env.supabase, .env.test-users
// (the service key is used ONLY for pre-test cleanup + assertions
//  about server-side state; every test request uses anon/user JWTs)
// ============================================================
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(resolve(root, file), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = { ...loadEnv('.env.supabase'), ...loadEnv('.env.test-users') };
const URL_ = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

// ---------- tiny client ------------------------------------
async function req(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token || ANON}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
async function svc(method, path, body, headers = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

// ---------- results ----------------------------------------
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}  ${detail}`); }
}

// ---------- main -------------------------------------------
async function signIn(email) {
  const r = await req('POST', '/auth/v1/token?grant_type=password', {
    body: { email, password: env.TEST_USER_PASSWORD },
  });
  if (!r.json?.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(r.json)}`);
  return { token: r.json.access_token, id: r.json.user.id, email };
}

const A_NAME = 'of_test_a', B_NAME = 'of_test_b', C_NAME = 'of_test_c';

async function cleanup(ids) {
  const inList = `in.(${ids.join(',')})`;
  // order matters only loosely (cascades handle most)
  await svc('DELETE', `/rest/v1/reports?reporter_id=${inList}`);
  await svc('DELETE', `/rest/v1/blocks?blocker_id=${inList}`);
  await svc('DELETE', `/rest/v1/follows?follower_id=${inList}`);
  await svc('DELETE', `/rest/v1/likes?user_id=${inList}`);
  await svc('DELETE', `/rest/v1/comments?author_id=${inList}`);
  await svc('DELETE', `/rest/v1/check_ins?user_id=${inList}`);
  await svc('DELETE', `/rest/v1/posts?author_id=${inList}`);
  await svc('DELETE', `/rest/v1/benchmark_contributions?user_id=${inList}`);
  await svc('DELETE', `/rest/v1/gym_members?user_id=${inList}`);
  await svc('DELETE', `/rest/v1/gyms?name_key=eq.of test barbell club`);
  await svc('DELETE', `/rest/v1/profiles?id=${inList}`);
}

const day = (offset) => {
  const d = new Date(Date.now() - offset * 86400000);
  return d.toISOString().slice(0, 10);
};

(async () => {
  console.log('== OptimalFit RLS test suite ==');
  const A = await signIn(env.TEST_USER_A_EMAIL);
  const B = await signIn(env.TEST_USER_B_EMAIL);
  const C = await signIn(env.TEST_USER_C_EMAIL);
  await cleanup([A.id, B.id, C.id]);

  // ---------- (a) anon can write nothing, read nothing ------
  let r = await req('POST', '/rest/v1/profiles', { body: { id: A.id, username: A_NAME } });
  check('a1: anon cannot insert profile', r.status === 401 || r.status === 403, `got ${r.status}`);
  r = await req('POST', '/rest/v1/posts', { body: { author_id: A.id, kind: 'photo' } });
  check('a2: anon cannot insert post', r.status === 401 || r.status === 403, `got ${r.status}`);
  r = await req('POST', '/rest/v1/check_ins', { body: { user_id: A.id } });
  check('a3: anon cannot insert check-in', r.status === 401 || r.status === 403, `got ${r.status}`);
  r = await req('GET', '/rest/v1/profiles?select=id');
  check('a4: anon reads zero profile rows', r.status === 200 && Array.isArray(r.json) && r.json.length === 0,
    `got ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  r = await req('POST', '/rest/v1/rpc/get_discover_feed', { body: {} });
  check('a5: anon cannot call discover feed RPC', r.status === 401 || r.status === 403 || r.status === 404, `got ${r.status}`);

  // ---------- (b) user A basic flows -------------------------
  r = await req('POST', '/rest/v1/profiles', {
    token: A.token,
    body: { id: A.id, username: A_NAME, display_name: 'Test A', bio: 'hello', tos_accepted_at: new Date().toISOString() },
  });
  check('b1: A creates own profile', r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
  await req('POST', '/rest/v1/profiles', { token: B.token, body: { id: B.id, username: B_NAME, tos_accepted_at: new Date().toISOString() } });
  await req('POST', '/rest/v1/profiles', { token: C.token, body: { id: C.id, username: C_NAME, tos_accepted_at: new Date().toISOString() } });

  r = await req('POST', '/rest/v1/posts', {
    token: A.token,
    headers: { Prefer: 'return=representation' },
    body: { author_id: A.id, kind: 'photo', caption: 'first pump' },
  });
  const aPost = r.json?.[0];
  check('b2: A creates own post', r.status === 201 && !!aPost?.id, `got ${r.status}`);

  r = await req('POST', '/rest/v1/posts', {
    token: B.token, headers: { Prefer: 'return=representation' },
    body: { author_id: B.id, kind: 'workout', caption: 'leg day' },
  });
  const bPost = r.json?.[0];
  check('b3: B creates own post', r.status === 201 && !!bPost?.id, `got ${r.status}`);

  // A follows B; C follows A and B; B follows A
  r = await req('POST', '/rest/v1/follows', { token: A.token, body: { follower_id: A.id, followee_id: B.id } });
  check('b4: A follows B', r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
  await req('POST', '/rest/v1/follows', { token: B.token, body: { follower_id: B.id, followee_id: A.id } });
  await req('POST', '/rest/v1/follows', { token: C.token, body: { follower_id: C.id, followee_id: A.id } });
  await req('POST', '/rest/v1/follows', { token: C.token, body: { follower_id: C.id, followee_id: B.id } });

  r = await req('POST', '/rest/v1/likes', { token: A.token, body: { post_id: bPost.id, user_id: A.id } });
  check('b5: A likes B post', r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
  r = await req('POST', '/rest/v1/comments', {
    token: A.token, body: { post_id: bPost.id, author_id: A.id, body: 'nice squats' },
  });
  check('b6: A comments on B post', r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);

  r = await svc('GET', `/rest/v1/posts?id=eq.${bPost.id}&select=like_count,comment_count`);
  check('b7: counter caches updated by trigger',
    r.json?.[0]?.like_count === 1 && r.json?.[0]?.comment_count === 1,
    JSON.stringify(r.json));

  r = await req('POST', '/rest/v1/check_ins', { token: A.token, body: { user_id: A.id } });
  check('b8: A checks in today', r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
  await req('POST', '/rest/v1/check_ins', { token: B.token, body: { user_id: B.id } });
  await req('POST', '/rest/v1/check_ins', { token: C.token, body: { user_id: C.id } });

  r = await req('POST', '/rest/v1/rpc/get_home_feed', { token: A.token, body: {} });
  const feedIds = (r.json || []).map((p) => p.id);
  check('b9: A home feed has own + followed posts',
    r.status === 200 && feedIds.includes(aPost.id) && feedIds.includes(bPost.id),
    `got ${r.status} ids=${feedIds.length}`);

  // ---------- (c) forgery / tamper attempts ------------------
  r = await req('POST', '/rest/v1/posts', { token: A.token, body: { author_id: B.id, kind: 'photo', caption: 'forged' } });
  check('c1: A cannot post as B', r.status === 401 || r.status === 403, `got ${r.status}`);

  r = await req('PATCH', `/rest/v1/posts?id=eq.${bPost.id}`, {
    token: A.token, headers: { Prefer: 'return=representation' }, body: { caption: 'hacked' },
  });
  check('c2: A cannot edit B post (0 rows affected)',
    (r.status === 200 || r.status === 204) && (!Array.isArray(r.json) || r.json.length === 0),
    `got ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  r = await svc('GET', `/rest/v1/posts?id=eq.${bPost.id}&select=caption`);
  check('c3: B post caption unchanged', r.json?.[0]?.caption === 'leg day', JSON.stringify(r.json));

  r = await req('POST', '/rest/v1/likes', { token: A.token, body: { post_id: bPost.id, user_id: A.id } });
  check('c4: A cannot like the same post twice', r.status === 409, `got ${r.status}`);

  r = await req('POST', '/rest/v1/check_ins', { token: A.token, body: { user_id: A.id } });
  check('c5: A cannot check in twice same day', r.status === 409, `got ${r.status}`);

  r = await req('POST', '/rest/v1/check_ins', {
    token: A.token, body: { user_id: A.id, day: day(3), created_at: new Date(Date.now() - 3 * 86400000).toISOString() },
  });
  check('c6: A cannot backdate a check-in (server forces today -> 409)',
    r.status === 409, `got ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);

  r = await req('POST', '/rest/v1/posts', { token: A.token, body: { author_id: A.id, kind: 'photo', caption: 'sneak', verified: true } });
  check('c7: A cannot insert post with verified=true', r.status === 401 || r.status === 403, `got ${r.status}`);

  r = await req('PATCH', `/rest/v1/posts?id=eq.${aPost.id}`, { token: A.token, body: { verified: true } });
  check('c8: A cannot flip verified on own post (freeze trigger)',
    r.status === 401 || r.status === 403, `got ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);

  r = await req('GET', '/rest/v1/benchmark_contributions?select=*', { token: A.token });
  check('c9: A cannot read benchmark_contributions',
    r.status === 401 || r.status === 403 || r.status === 404, `got ${r.status}`);

  await req('POST', '/rest/v1/reports', { token: A.token, body: { reporter_id: A.id, target_post_id: bPost.id, reason: 'test report' } });
  r = await req('GET', '/rest/v1/reports?select=*', { token: A.token });
  check('c10: A cannot read reports (even own)',
    (r.status === 200 && Array.isArray(r.json) && r.json.length === 0) || r.status === 401 || r.status === 403,
    `got ${r.status} rows=${Array.isArray(r.json) ? r.json.length : '?'}`);

  r = await req('POST', '/rest/v1/comments', {
    token: A.token, body: { post_id: bPost.id, author_id: A.id, body: 'x'.repeat(501) },
  });
  check('c11: 501-char comment rejected by check constraint', r.status === 400, `got ${r.status}`);

  // ---------- (d) create_receipt_post ------------------------
  const validSeries = [];
  for (let i = 0; i < 8; i++) {
    validSeries.push({ day: day(42 - i * 6), e1rm: 100 + i * 1.5 }); // ~1%/wk, 42-day span
  }
  r = await req('POST', '/rest/v1/rpc/create_receipt_post', {
    token: A.token,
    body: {
      p_kind: 'receipt', p_caption: 'Bench PR!',
      p_receipt: { type: 'pr', lift: 'Bench Press', training_age: '1to3y', series: validSeries },
    },
  });
  check('d1: valid PR receipt -> verified=true',
    r.status === 200 && r.json?.verified === true, `got ${r.status} ${JSON.stringify(r.json)}`);
  const verifiedPostId = r.json?.post_id;
  let rr = await svc('GET', `/rest/v1/posts?id=eq.${verifiedPostId}&select=verified,kind`);
  check('d2: post row is verified receipt', rr.json?.[0]?.verified === true && rr.json?.[0]?.kind === 'receipt', JSON.stringify(rr.json));
  rr = await svc('GET', `/rest/v1/benchmark_contributions?user_id=eq.${A.id}&select=receipt_type,lift_key,weekly_progress_pct`);
  check('d3: verified PR contributed to benchmarks',
    rr.json?.length === 1 && rr.json[0].lift_key === 'bench press', JSON.stringify(rr.json));

  r = await req('POST', '/rest/v1/rpc/create_receipt_post', {
    token: A.token,
    body: {
      p_kind: 'receipt', p_caption: 'insane gains',
      p_receipt: {
        type: 'pr', lift: 'Deadlift',
        series: [{ day: day(7), e1rm: 100 }, { day: day(0), e1rm: 120 }], // 2 sessions, +20%/wk
      },
    },
  });
  check('d4: implausible PR receipt -> NOT verified, reason returned',
    r.status === 200 && r.json?.verified === false && typeof r.json?.reason === 'string',
    `got ${r.status} ${JSON.stringify(r.json)}`);

  r = await req('POST', '/rest/v1/rpc/create_receipt_post', {
    token: A.token,
    body: { p_kind: 'receipt', p_caption: null, p_receipt: { type: 'bogus' } },
  });
  check('d5: structurally invalid receipt type -> hard error', r.status >= 400, `got ${r.status}`);

  // ---------- report auto-hide (3 distinct reporters) ---------
  r = await req('POST', '/rest/v1/posts', {
    token: A.token, headers: { Prefer: 'return=representation' },
    body: { author_id: A.id, kind: 'meal', caption: 'spam post' },
  });
  const spamPost = r.json?.[0];
  for (const u of [A, B, C]) {
    await req('POST', '/rest/v1/reports', { token: u.token, body: { reporter_id: u.id, target_post_id: spamPost.id, reason: 'spam content' } });
  }
  rr = await svc('GET', `/rest/v1/posts?id=eq.${spamPost.id}&select=hidden`);
  check('m1: post auto-hidden at >=3 distinct reporters', rr.json?.[0]?.hidden === true, JSON.stringify(rr.json));
  r = await req('GET', `/rest/v1/posts?id=eq.${spamPost.id}&select=id`, { token: B.token });
  check('m2: hidden post invisible to others', r.json?.length === 0, JSON.stringify(r.json));
  r = await req('GET', `/rest/v1/posts?id=eq.${spamPost.id}&select=id,hidden`, { token: A.token });
  check('m3: author still sees own hidden post', r.json?.length === 1 && r.json[0].hidden === true, JSON.stringify(r.json));

  // ---------- (f-pre) leaderboards before blocks --------------
  r = await req('POST', '/rest/v1/rpc/get_friends_leaderboard', { token: C.token, body: { p_metric: 'streak' } });
  const lbIds = (r.json || []).map((x) => x.user_id);
  check('f1: friends leaderboard (C) has C+A+B with sane values',
    r.status === 200 && lbIds.length === 3 && lbIds.includes(A.id) && lbIds.includes(B.id) && lbIds.includes(C.id)
      && (r.json || []).every((x) => x.value === 1 && x.rank === 1),
    `got ${r.status} ${JSON.stringify(r.json)}`);

  r = await req('POST', '/rest/v1/rpc/get_friends_leaderboard', { token: C.token, body: { p_metric: 'receipts' } });
  const recRow = (r.json || []).find((x) => x.user_id === A.id);
  check('f2: receipts metric counts only verified receipts (A=1)',
    r.status === 200 && recRow?.value === 1, `got ${r.status} ${JSON.stringify(r.json)}`);

  // gym leaderboard
  r = await req('POST', '/rest/v1/gyms', {
    token: A.token, headers: { Prefer: 'return=representation' },
    body: { name: 'OF Test Barbell Club', created_by: A.id },
  });
  const gym = r.json?.[0];
  check('f3: A creates a gym', r.status === 201 && !!gym?.id, `got ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
  await req('POST', '/rest/v1/gym_members', { token: A.token, body: { gym_id: gym.id, user_id: A.id } });
  await req('POST', '/rest/v1/gym_members', { token: B.token, body: { gym_id: gym.id, user_id: B.id } });

  r = await req('POST', '/rest/v1/rpc/get_gym_leaderboard', { token: C.token, body: { p_gym_id: gym.id, p_metric: 'days7' } });
  check('f4: non-member cannot read gym leaderboard', r.status === 401 || r.status === 403, `got ${r.status}`);

  r = await req('POST', '/rest/v1/rpc/get_gym_leaderboard', { token: A.token, body: { p_gym_id: gym.id, p_metric: 'days7' } });
  check('f5: gym leaderboard (A) has A+B',
    r.status === 200 && r.json?.length === 2 && r.json.every((x) => x.value === 1),
    `got ${r.status} ${JSON.stringify(r.json)}`);

  // ---------- (e) blocks hide everything ----------------------
  r = await req('POST', '/rest/v1/blocks', { token: B.token, body: { blocker_id: B.id, blocked_id: A.id } });
  check('e1: B blocks A', r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);

  r = await req('POST', '/rest/v1/rpc/get_discover_feed', { token: B.token, body: {} });
  check('e2: A posts gone from B discover',
    r.status === 200 && !(r.json || []).some((p) => p.author_id === A.id), `got ${r.status}`);
  r = await req('POST', '/rest/v1/rpc/get_discover_feed', { token: A.token, body: {} });
  check('e3: B posts gone from A discover (blocked side)',
    r.status === 200 && !(r.json || []).some((p) => p.author_id === B.id), `got ${r.status}`);
  r = await req('POST', '/rest/v1/rpc/get_home_feed', { token: A.token, body: {} });
  check('e4: B posts gone from A home feed (follow severed + RLS)',
    r.status === 200 && !(r.json || []).some((p) => p.author_id === B.id), `got ${r.status}`);
  r = await req('GET', `/rest/v1/profiles?id=eq.${A.id}&select=id`, { token: B.token });
  check('e5: A profile invisible to B', r.json?.length === 0, JSON.stringify(r.json));
  r = await req('GET', `/rest/v1/comments?post_id=eq.${bPost.id}&select=id`, { token: B.token });
  check('e6: A comment on B post hidden from B after block', r.json?.length === 0, JSON.stringify(r.json));
  r = await svc('GET', `/rest/v1/follows?follower_id=eq.${B.id}&followee_id=eq.${A.id}`);
  check('e7: block severed follow edges', r.json?.length === 0, JSON.stringify(r.json));
  r = await req('POST', '/rest/v1/follows', { token: A.token, body: { follower_id: A.id, followee_id: B.id } });
  check('e8: A cannot re-follow B across block', r.status === 401 || r.status === 403, `got ${r.status}`);

  // ---------- (f) leaderboards exclude blocked users -----------
  r = await req('POST', '/rest/v1/rpc/get_gym_leaderboard', { token: B.token, body: { p_gym_id: gym.id, p_metric: 'streak' } });
  check('f6: gym leaderboard for B excludes blocked A',
    r.status === 200 && r.json?.length === 1 && r.json[0].user_id === B.id,
    `got ${r.status} ${JSON.stringify(r.json)}`);
  r = await req('POST', '/rest/v1/rpc/get_friends_leaderboard', { token: B.token, body: { p_metric: 'streak' } });
  check('f7: friends leaderboard for B excludes blocked A',
    r.status === 200 && !(r.json || []).some((x) => x.user_id === A.id),
    `got ${r.status} ${JSON.stringify(r.json)}`);

  // ---------- (g) benchmark k-anonymity ------------------------
  r = await req('POST', '/rest/v1/rpc/get_benchmarks', {
    token: C.token, body: { p_receipt_type: 'pr', p_lift: 'Bench Press' },
  });
  check('g1: benchmark cohort below k=5 returns empty',
    r.status === 200 && Array.isArray(r.json) && r.json.length === 0,
    `got ${r.status} ${JSON.stringify(r.json)}`);
  r = await req('POST', '/rest/v1/rpc/get_benchmarks', { token: C.token, body: { p_receipt_type: 'pr' } });
  check('g2: unfiltered benchmark query also withholds tiny cohorts',
    r.status === 200 && Array.isArray(r.json) && r.json.length === 0,
    `got ${r.status} ${JSON.stringify(r.json)}`);

  // ---------- summary ------------------------------------------
  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
