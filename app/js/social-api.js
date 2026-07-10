/* ============================================================
   social-api.js — OF.socialApi: the ONLY module that talks to
   Supabase. Owns the client + session; every UI module calls
   these typed functions and never touches window.supabase.

   Contract: docs/BACKEND.md. Key rules honored here:
     - anon (signed-out) access is deny-all → UI requires sign-in
     - 409 / 23505 conflicts are idempotent no-ops (err.conflict)
     - clients only ever set author_id/kind/caption/image_path on
       posts (verified/hidden/counters are server-owned)
     - storage keys must start "<uid>/"; public CDN URLs for read
     - account deletion via the delete_account() SECURITY DEFINER
       RPC (client can't delete auth.users rows) — storage files
       are best-effort removed via the Storage API first.

   The publishable anon key below is PUBLIC BY DESIGN (RLS is the
   security boundary). No service key may ever appear in app/.

   Local cache: localStorage "optimalfit.social" holds ONLY the
   cached own-profile + usernames of people the user blocked
   (blocked profiles become unreadable server-side, so we keep the
   name locally to label the unblock list). The auth session lives
   under "optimalfit.social.auth" (managed by supabase-js).
   Tracking data is NEVER uploaded — only explicit posts.
   ============================================================ */

window.OF = window.OF || {};

OF.socialApi = (function () {
  "use strict";

  var SUPABASE_URL = "https://puopvaqquujalwnzwyov.supabase.co";
  var SUPABASE_KEY = "sb_publishable_KpqtaG-FzvdTucqivGDsTw_dAFmnx_1";
  var CACHE_KEY = "optimalfit.social";
  var AUTH_KEY = "optimalfit.social.auth";

  var client = null;
  var user = null;          // current auth user object (or null)
  var ready = null;         // promise: initial getSession resolved
  var authCallbacks = [];

  /* ---------------- client + session ---------------- */

  function available() {
    return typeof window.supabase !== "undefined" &&
      typeof window.supabase.createClient === "function";
  }

  function sb() {
    if (!client) {
      if (!available()) throw normErr({ message: "supabase library missing" });
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          storageKey: AUTH_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      client.auth.onAuthStateChange(function (_event, session) {
        var before = user && user.id;
        user = session ? session.user : null;
        var after = user && user.id;
        if (before !== after) {
          authCallbacks.forEach(function (cb) {
            try { cb(user); } catch (e) { console.error(e); }
          });
        }
      });
    }
    return client;
  }

  /** Resolve once the persisted session (if any) has been restored.
      Always resolves with the CURRENT user (init may be re-awaited
      after later sign-ins/outs, so never the first run's snapshot). */
  function init() {
    if (!ready) {
      if (!available()) ready = Promise.resolve(null);
      else {
        ready = sb().auth.getSession().then(function (res) {
          var e = res && res.error;
          if (e) {
            // An EXPIRED token that couldn't be refreshed offline comes back
            // as a network error here (session null + AuthRetryableFetchError).
            // That's OFFLINE, not signed-out: supabase-js keeps the persisted
            // session for a later retry, so surface offline and let the caller
            // show a degraded/offline state instead of the signed-out pitch.
            var ne = normErr(e);
            if (ne.offline) {
              if (res.data && res.data.session) user = res.data.session.user;
              throw ne;
            }
            // any other error (e.g. a revoked refresh token) = truly signed out
          }
          user = (res.data && res.data.session) ? res.data.session.user : null;
          // truly signed out: the cached profile must not outlive the session,
          // or entitlements would keep Premium/trial unlocked while logged out
          if (!user) writeCache({ profile: null });
        }).catch(function (e) {
          var ne = (e && e.offline === true) ? e : normErr(e);
          if (ne.offline) {
            ready = null;   // drop the memo so a later init() retries when online
            throw ne;       // reject → caller keeps the session, shows offline
          }
          user = null;      // signed-out / unexpected: resolve as logged-out
          writeCache({ profile: null });  // same rule as above
        });
      }
    }
    return ready.then(function () { return user; });
  }

  function onAuthChange(cb) { authCallbacks.push(cb); }
  function currentUser() { return user; }
  function uid() { return user ? user.id : null; }

  /* ---------------- error normalization ---------------- */

  function normErr(e) {
    var err = {
      message: "Something went wrong — please try again.",
      code: "", status: 0,
      offline: false, conflict: false, authExpired: false
    };
    if (!e) return err;
    var msg = String(e.message || e.error_description || "");
    if (e.name === "TypeError" || e.name === "AuthRetryableFetchError" ||
        /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
      err.offline = true;
      err.message = "You look offline — check your connection and try again.";
      return err;
    }
    err.code = e.code || "";
    err.status = e.status || e.statusCode || 0;
    if (err.status === 409 || err.code === "23505") {
      err.conflict = true;
      err.message = "Already done.";
      return err;
    }
    if (err.status === 401 || err.code === "PGRST301" ||
        /jwt expired|invalid token|not authenticated/i.test(msg)) {
      err.authExpired = true;
      err.message = "Your session expired — please sign in again.";
      return err;
    }
    if (msg) err.message = msg;
    return err;
  }

  /** Unwrap a supabase {data, error} response; throw normalized error. */
  function check(res) {
    if (res && res.error) throw normErr(res.error);
    return res ? res.data : null;
  }

  /** Swallow duplicate-conflicts: resolves { already: true }. */
  function idem(promise) {
    return promise.catch(function (e) {
      if (e && e.conflict) return { already: true };
      throw e;
    });
  }

  function requireUser() {
    if (!uid()) throw normErr({ message: "not authenticated", status: 401 });
  }

  /* ---------------- local cache (optimalfit.social) ---------------- */

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return (obj && typeof obj === "object") ? obj : {};
    } catch (e) { return {}; }
  }
  function writeCache(patch) {
    try {
      var c = readCache();
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* private mode: cache is optional */ }
  }
  function clearLocal() {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
  }
  function cachedProfile() { return readCache().profile || null; }
  function rememberBlockedName(id, name) {
    var names = readCache().blockedNames || {};
    if (name) names[id] = name; else delete names[id];
    writeCache({ blockedNames: names });
  }
  function blockedNames() { return readCache().blockedNames || {}; }

  /* ---------------- auth ---------------- */

  function signUp(email, password) {
    return sb().auth.signUp({ email: email, password: password })
      .then(function (res) {
        if (res.error) throw normErr(res.error);
        // session is null when email confirmation is required
        return { user: res.data.user, session: res.data.session };
      });
  }

  function signIn(email, password) {
    return sb().auth.signInWithPassword({ email: email, password: password })
      .then(function (res) {
        if (res.error) throw normErr(res.error);
        return res.data.session;
      });
  }

  function signOut() {
    return sb().auth.signOut().catch(function () { /* local sign-out still happened */ })
      .then(function () { writeCache({ profile: null }); });
  }

  /* ---------------- profiles ---------------- */

  function getMyProfile() {
    requireUser();
    return sb().from("profiles").select("*").eq("id", uid()).maybeSingle()
      .then(check).then(function (p) {
        writeCache({ profile: p || null });
        return p;
      });
  }

  /** Username availability — needs an authenticated session (anon is deny-all). */
  function usernameAvailable(username) {
    return sb().from("profiles").select("id", { count: "exact", head: true })
      .eq("username", username)
      .then(function (res) {
        if (res.error) throw normErr(res.error);
        return res.count === 0;
      });
  }

  function createProfile(username, displayName) {
    requireUser();
    return sb().from("profiles").insert({
      id: uid(),
      username: username,
      display_name: displayName || null,
      tos_accepted_at: new Date().toISOString()
    }).select().single().then(check).then(function (p) {
      writeCache({ profile: p });
      return p;
    });
  }

  /** Patch own profile row (display_name, bio, avatar_url, stats_summary). */
  function updateProfile(fields) {
    requireUser();
    return sb().from("profiles").update(fields).eq("id", uid())
      .select().single().then(check).then(function (p) {
        writeCache({ profile: p });
        return p;
      });
  }

  /** Public profile (null when missing or blocked either way). */
  function getProfile(userId) {
    return sb().from("profiles").select("*").eq("id", userId).maybeSingle()
      .then(check);
  }

  function getFollowCounts(userId) {
    var followers = sb().from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("followee_id", userId);
    var following = sb().from("follows")
      .select("followee_id", { count: "exact", head: true })
      .eq("follower_id", userId);
    return Promise.all([followers, following]).then(function (rs) {
      if (rs[0].error) throw normErr(rs[0].error);
      if (rs[1].error) throw normErr(rs[1].error);
      return { followers: rs[0].count || 0, following: rs[1].count || 0 };
    });
  }

  function isFollowing(userId) {
    requireUser();
    return sb().from("follows").select("followee_id")
      .eq("follower_id", uid()).eq("followee_id", userId).maybeSingle()
      .then(check).then(function (row) { return !!row; });
  }

  function follow(userId) {
    requireUser();
    return idem(sb().from("follows")
      .insert({ follower_id: uid(), followee_id: userId }).then(check));
  }

  function unfollow(userId) {
    requireUser();
    return sb().from("follows").delete()
      .eq("follower_id", uid()).eq("followee_id", userId).then(check);
  }

  /* ---------------- storage ---------------- */

  function publicUrl(bucket, key) {
    if (!key) return "";
    // Only ever hand back URLs that point INTO our own Supabase storage.
    // A stored key/image_path that is an absolute URL is either one of our
    // own public CDN URLs (accept) or an attacker-supplied external URL —
    // the same tracking-beacon vector already fixed for avatar_url. Ignore
    // the latter so a tampered post image can never load a third-party URL.
    if (/^https?:\/\//i.test(key)) {
      var own = SUPABASE_URL + "/storage/v1/object/public/";
      return key.indexOf(own) === 0 ? key : "";
    }
    return SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + key;
  }

  function uploadTo(bucket, key, blob) {
    return sb().storage.from(bucket)
      .upload(key, blob, { contentType: "image/jpeg", upsert: false })
      .then(check);
  }

  /** Upload avatar JPEG blob; returns the public URL (also saved on profile). */
  function uploadAvatar(blob) {
    requireUser();
    var key = uid() + "/avatar-" + Date.now() + ".jpg";
    return uploadTo("avatars", key, blob).then(function () {
      return updateProfile({ avatar_url: publicUrl("avatars", key) });
    }).then(function (p) { return p.avatar_url; });
  }

  /** Upload a post image JPEG blob; returns the storage key. */
  function uploadPostImage(blob) {
    requireUser();
    var key = uid() + "/post-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 8) + ".jpg";
    return uploadTo("post-images", key, blob).then(function () { return key; });
  }

  /* ---------------- posts / feed ---------------- */

  function createPost(kind, caption, imagePath) {
    requireUser();
    return sb().from("posts").insert({
      author_id: uid(),
      kind: kind,
      caption: caption || null,
      image_path: imagePath || null
    }).select().single().then(check);
  }

  function deletePost(postId) {
    requireUser();
    return sb().from("posts").delete().eq("id", postId).then(check);
  }

  function getHomeFeed(limit, before) {
    return sb().rpc("get_home_feed", { p_limit: limit || 20, p_before: before || null })
      .then(check);
  }

  function getDiscoverFeed(limit, before) {
    return sb().rpc("get_discover_feed", { p_limit: limit || 20, p_before: before || null })
      .then(check);
  }

  /** A user's posts for their profile page (RLS hides hidden/blocked). */
  function getUserPosts(userId, limit, before) {
    var q = sb().from("posts").select("*").eq("author_id", userId)
      .order("created_at", { ascending: false }).limit(limit || 20);
    if (before) q = q.lt("created_at", before);
    return q.then(check).then(function (posts) {
      posts = posts || [];
      if (!posts.length || !uid()) return { posts: posts, likedIds: {} };
      var ids = posts.map(function (p) { return p.id; });
      return sb().from("likes").select("post_id")
        .eq("user_id", uid()).in("post_id", ids)
        .then(check).then(function (likes) {
          var likedIds = {};
          (likes || []).forEach(function (l) { likedIds[l.post_id] = true; });
          return { posts: posts, likedIds: likedIds };
        });
    });
  }

  /* ---------------- likes / comments ---------------- */

  function like(postId) {
    requireUser();
    return idem(sb().from("likes")
      .insert({ post_id: postId, user_id: uid() }).then(check));
  }

  function unlike(postId) {
    requireUser();
    return sb().from("likes").delete()
      .eq("post_id", postId).eq("user_id", uid()).then(check);
  }

  /**
   * Comments for a post, oldest-first, each with author info embedded.
   * opts.limit caps how many NEWEST comments come back (still returned
   * oldest-first for display).
   */
  function getComments(postId, opts) {
    opts = opts || {};
    var q = sb().from("comments")
      .select("id,post_id,author_id,body,created_at," +
        "author:profiles!comments_author_id_fkey(username,display_name,avatar_url)")
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .limit(opts.limit || 100);
    return q.then(check).then(function (rows) {
      return (rows || []).reverse();
    });
  }

  function addComment(postId, body) {
    requireUser();
    return sb().from("comments").insert({
      post_id: postId, author_id: uid(), body: body
    }).select("id,post_id,author_id,body,created_at," +
      "author:profiles!comments_author_id_fkey(username,display_name,avatar_url)")
      .single().then(check);
  }

  /** Allowed for the comment author OR the post author (RLS enforces). */
  function deleteComment(commentId) {
    requireUser();
    return sb().from("comments").delete().eq("id", commentId).then(check);
  }

  /* ---------------- gyms / check-ins ---------------- */

  function searchGyms(query) {
    var q = sb().from("gyms").select("id,name").order("name").limit(12);
    if (query) q = q.ilike("name", "%" + query.replace(/[%_]/g, "\\$&") + "%");
    return q.then(check);
  }

  /** Create a gym; duplicate name (name_key) resolves to the existing gym. */
  function createGym(name) {
    requireUser();
    return sb().from("gyms").insert({ name: name, created_by: uid() })
      .select("id,name").single().then(check)
      .catch(function (e) {
        if (e && e.conflict) {
          return sb().from("gyms").select("id,name")
            .eq("name_key", name.trim().toLowerCase()).maybeSingle().then(check);
        }
        throw e;
      });
  }

  function joinGym(gymId) {
    requireUser();
    return idem(sb().from("gym_members")
      .insert({ gym_id: gymId, user_id: uid() }).then(check));
  }

  function leaveGym(gymId) {
    requireUser();
    return sb().from("gym_members").delete()
      .eq("gym_id", gymId).eq("user_id", uid()).then(check);
  }

  function myGyms() {
    requireUser();
    return sb().from("gym_members").select("gym_id,gyms(id,name)")
      .eq("user_id", uid()).then(check).then(function (rows) {
        return (rows || []).map(function (r) { return r.gyms; })
          .filter(function (g) { return !!g; });
      });
  }

  /**
   * One-tap daily check-in. day/created_at are server-set (UTC day);
   * second check-in of the (UTC) day resolves { already: true }.
   */
  function checkIn(gymId) {
    requireUser();
    return idem(sb().from("check_ins")
      .insert({ user_id: uid(), gym_id: gymId || null }).then(check));
  }

  /** Own check-ins, newest first (select-own-only per RLS). */
  function getMyCheckIns(limit) {
    requireUser();
    return sb().from("check_ins").select("id,day,gym_id,created_at")
      .eq("user_id", uid())
      .order("day", { ascending: false }).limit(limit || 90).then(check);
  }

  /* ---------------- leaderboards / benchmarks ---------------- */

  /** metric: streak | days7 | days28 | receipts */
  function getFriendsLeaderboard(metric) {
    return sb().rpc("get_friends_leaderboard", { p_metric: metric || "streak" })
      .then(check);
  }

  function getGymLeaderboard(gymId, metric) {
    return sb().rpc("get_gym_leaderboard", { p_gym_id: gymId, p_metric: metric || "streak" })
      .then(check);
  }

  /** Empty array = cohort withheld (k-anonymity) — "not enough data yet". */
  function getBenchmarks(receiptType, lift, trainingAge) {
    return sb().rpc("get_benchmarks", {
      p_receipt_type: receiptType,
      p_lift: lift || null,
      p_training_age: trainingAge || null
    }).then(check);
  }

  /** The verified-receipt path (used by the receipts feature, P3-6). */
  function createReceiptPost(caption, receipt) {
    requireUser();
    return sb().rpc("create_receipt_post", {
      p_kind: "receipt", p_caption: caption || null, p_receipt: receipt
    }).then(check);
  }

  /* ---------------- moderation ---------------- */

  /**
   * target: { postId } | { commentId } | { userId } (exactly one).
   * Duplicate report of the same target resolves { already: true }.
   */
  function report(target, reason) {
    requireUser();
    return idem(sb().from("reports").insert({
      reporter_id: uid(),
      target_post_id: target.postId || null,
      target_comment_id: target.commentId || null,
      target_user_id: target.userId || null,
      reason: reason
    }).then(check));
  }

  /** Block a user. Remember their username locally: after the block their
      profile becomes unreadable to us, so the unblock list needs a label. */
  function block(userId, username) {
    requireUser();
    return idem(sb().from("blocks")
      .insert({ blocker_id: uid(), blocked_id: userId }).then(check))
      .then(function (r) {
        rememberBlockedName(userId, username || "someone");
        return r;
      });
  }

  function unblock(userId) {
    requireUser();
    return sb().from("blocks").delete()
      .eq("blocker_id", uid()).eq("blocked_id", userId).then(check)
      .then(function (r) { rememberBlockedName(userId, null); return r; });
  }

  function getBlocked() {
    requireUser();
    return sb().from("blocks").select("blocked_id,created_at")
      .eq("blocker_id", uid()).order("created_at", { ascending: false })
      .then(check).then(function (rows) {
        var names = blockedNames();
        return (rows || []).map(function (r) {
          return {
            userId: r.blocked_id,
            username: names[r.blocked_id] || "blocked user",
            createdAt: r.created_at
          };
        });
      });
  }

  /* ---------------- account deletion ---------------- */

  /**
   * Deletes EVERYTHING server-side, in two strict steps:
   *   1. remove every uploaded file via the Storage API (RLS lets us
   *      delete our own "<uid>/..." keys). Supabase forbids SQL deletes
   *      on storage tables, so this MUST happen client-side — and if it
   *      fails we ABORT so no photos are ever left behind.
   *   2. the delete_account() RPC removes benchmark rows + the auth
   *      user, which cascades through profiles to all content.
   * Finally signs out locally and clears the optimalfit.social cache.
   */
  function deleteAccount() {
    requireUser();
    var id = uid();
    var buckets = ["avatars", "post-images"];
    function drainBucket(bucket) {
      return sb().storage.from(bucket).list(id, { limit: 1000 }).then(function (res) {
        if (res.error) throw normErr(res.error);
        var files = (res.data || []).map(function (f) { return id + "/" + f.name; });
        if (!files.length) return null;
        return sb().storage.from(bucket).remove(files).then(function (r) {
          if (r.error) throw normErr(r.error);
          return drainBucket(bucket); // page until empty
        });
      });
    }
    var cleanup = Promise.all(buckets.map(drainBucket));
    return cleanup.then(function () {
      return sb().rpc("delete_account").then(check);
    }).then(function () {
      // the auth user no longer exists; drop the local session + cache
      return sb().auth.signOut().catch(function () { /* expected: user gone */ });
    }).then(function () {
      clearLocal();
      user = null;
      authCallbacks.forEach(function (cb) {
        try { cb(null); } catch (e) { console.error(e); }
      });
    });
  }

  /* ---------------- exports ---------------- */

  return {
    available: available,
    init: init,
    onAuthChange: onAuthChange,
    currentUser: currentUser,
    uid: uid,
    normErr: normErr,

    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    deleteAccount: deleteAccount,

    getMyProfile: getMyProfile,
    cachedProfile: cachedProfile,
    usernameAvailable: usernameAvailable,
    createProfile: createProfile,
    updateProfile: updateProfile,
    getProfile: getProfile,
    getFollowCounts: getFollowCounts,
    isFollowing: isFollowing,
    follow: follow,
    unfollow: unfollow,

    publicUrl: publicUrl,
    uploadAvatar: uploadAvatar,
    uploadPostImage: uploadPostImage,

    createPost: createPost,
    createReceiptPost: createReceiptPost,
    deletePost: deletePost,
    getHomeFeed: getHomeFeed,
    getDiscoverFeed: getDiscoverFeed,
    getUserPosts: getUserPosts,

    like: like,
    unlike: unlike,
    getComments: getComments,
    addComment: addComment,
    deleteComment: deleteComment,

    searchGyms: searchGyms,
    createGym: createGym,
    joinGym: joinGym,
    leaveGym: leaveGym,
    myGyms: myGyms,
    checkIn: checkIn,
    getMyCheckIns: getMyCheckIns,

    getFriendsLeaderboard: getFriendsLeaderboard,
    getGymLeaderboard: getGymLeaderboard,
    getBenchmarks: getBenchmarks,

    report: report,
    block: block,
    unblock: unblock,
    getBlocked: getBlocked
  };
})();
