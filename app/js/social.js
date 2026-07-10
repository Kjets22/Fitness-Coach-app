/* ============================================================
   social.js — OF.social: the Community tab.

   States (like coach.js health-gating):
     - library missing / offline  → friendly degrade card
     - signed out                 → opt-in pitch (privacy promise)
     - signed up, email pending   → "check your email"
     - signed in, no profile row  → username picker (profile setup)
     - signed in                  → Home/Discover feed, composer,
                                    check-ins, gyms, leaderboards

   Also renders the "Community" card inside the Settings tab
   (sign out, blocked users, delete account, terms).

   ALL user content renders through U.esc(). Server-side RLS makes
   blocked/hidden content simply absent — no special UI needed.
   Two stacked sheet layers (#social-sheet / #social-sheet2) are
   shared with social-profile.js and social-compose.js via
   OF.social.sheetOpen/sheetClose.
   ============================================================ */

window.OF = window.OF || {};

OF.social = (function () {
  "use strict";

  var U = OF.util;
  var A = OF.socialApi;
  var els = {};
  var st = {
    state: "loading",   // loading|nolib|offline|out|emailsent|setup|in
    profile: null,
    tosAccepted: false, // accepted on the sign-up sheet this session
    authMode: "signin",
    authError: "",
    authBusy: false,
    feedMode: "home",
    feed: [],
    feedDone: false,
    feedLoading: false,
    feedError: "",
    gyms: [],
    checkins: [],
    streak: 0,
    checkedToday: false,
    checkinBusy: false,
    lb: { scope: "friends", metric: "streak", rows: null, loading: false, error: "" }
  };
  var postReg = {};     // postId -> feed-shaped row (shared with profile sheets)
  var comments = {};    // postId -> { rows, expanded, total }

  /* ================= shared helpers (exported) ================= */

  function relTime(iso) {
    var t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    var s = (Date.now() - t) / 1000;
    if (s < 45) return "just now";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    if (s < 7 * 86400) return Math.round(s / 86400) + "d ago";
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  /** Local calendar date (YYYY-MM-DD) of an ISO timestamp — matches the
      format of OF.receipts.weekStartISO() (local Sunday). Empty string when
      unparseable. Used so the drop grouping never compares a UTC date slice
      against a local Sunday. */
  function localDateOf(iso) {
    var t = Date.parse(iso || "");
    if (isNaN(t)) return "";
    var d = new Date(t);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function avatarHtml(url, name, cls) {
    var c = "soc-ava" + (cls ? " " + cls : "");
    if (url) {
      return '<img class="' + c + '" src="' + U.esc(url) + '" alt="" loading="lazy" ' +
        'onerror="this.style.visibility=\'hidden\'">';
    }
    var letter = String(name || "?").trim().charAt(0).toUpperCase() || "?";
    return '<span class="' + c + ' soc-ava-txt" aria-hidden="true">' + U.esc(letter) + '</span>';
  }

  function displayNameOf(p) {
    if (!p) return "someone";
    return p.display_name || ("@" + (p.username || "user"));
  }

  /* two stacked sheet layers; level 2 renders above level 1 */
  function sheetEl(level) { return level === 2 ? els.sheet2 : els.sheet1; }

  function sheetOpen(level, html, cls) {
    var c = sheetEl(level);
    if (!c) return null;
    c.innerHTML = '<div class="sheet-backdrop" data-close-social="' + level + '"></div>' +
      '<div class="sheet-panel soc-panel ' + (cls || "") + '">' +
      '<div class="sheet-grab" aria-hidden="true"></div>' + html + '</div>';
    c.classList.remove("hidden");
    return c.querySelector(".sheet-panel");
  }

  function sheetClose(level) {
    var c = sheetEl(level);
    if (!c) return;
    c.classList.add("hidden");
    c.innerHTML = "";
  }

  function sheetIsOpen(level) {
    var c = sheetEl(level);
    return c && !c.classList.contains("hidden");
  }

  /** Central error surface: offline toast / expired-session handling. */
  function handleErr(e, fallback) {
    e = e || {};
    if (e.authExpired) {
      U.toast("Your session expired — please sign in again.", "warn");
      A.signOut().then(boot);
      return;
    }
    U.toast(e.offline ? e.message : (fallback || e.message || "Something went wrong."),
      e.offline ? "warn" : "error");
  }

  /* ================= post cards ================= */

  function registerPosts(rows) {
    (rows || []).forEach(function (r) { postReg[r.id] = r; });
  }
  function getPost(id) { return postReg[id] || null; }

  function removePostEverywhere(id) {
    delete postReg[id];
    st.feed = st.feed.filter(function (r) { return r.id !== id; });
    document.querySelectorAll('[data-post="' + id + '"]').forEach(function (n) {
      n.parentNode && n.parentNode.removeChild(n);
    });
  }

  function kindLabel(kind) {
    return kind === "workout" ? "Workout" :
      kind === "meal" ? "Meal" :
      kind === "receipt" ? "Receipt" : "";
  }

  /** Safe summary for receipt jsonb (P3-6). DEFENSIVE: the feed must render
      any receipt payload it encounters, however malformed. Returns
      { title, metric, sub, bodyHtml } — bodyHtml is built ONLY from
      validated numbers + U.esc()'d strings. Weights are kg in the payload
      and go through U.fmtWeight for the user's display unit. */
  function receiptBits(receipt) {
    /* A hostile/malformed receipt payload (possible via direct RPC insert)
       must never take down the whole feed render — degrade that one card. */
    try { return receiptBitsInner(receipt); }
    catch (e) { return { title: "Stat receipt", metric: "", sub: "", bodyHtml: "" }; }
  }
  function receiptBitsInner(receipt) {
    var r = (receipt && typeof receipt === "object") ? receipt : {};
    var num = function (v) { return (typeof v === "number" && isFinite(v)) ? v : null; };
    var bits = { title: "Stat receipt", metric: "", sub: "", bodyHtml: "" };
    if (r.type === "pr") {
      bits.title = (typeof r.lift === "string" ? r.lift : "Lift") + " — new PR";
      var series = (Array.isArray(r.series) ? r.series : []).filter(function (p) {
        return p && num(p.e1rm) != null;
      });
      var best = null;
      series.forEach(function (p) { if (best == null || p.e1rm > best) best = p.e1rm; });
      if (best != null) {
        bits.metric = U.fmtWeight(best, 1) + " e1RM";
        var dn = function (iso) {
          var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
          return m ? Math.round(new Date(+m[1], +m[2] - 1, +m[3]).getTime() / 86400000) : null;
        };
        var d0 = dn(series[0] && series[0].day), d1 = dn(series[series.length - 1] && series[series.length - 1].day);
        var weeks = (d0 != null && d1 != null) ? Math.max(1, Math.round((d1 - d0) / 7)) : null;
        var nSess = num(r.sessions) != null ? r.sessions : series.length;
        bits.sub = nSess + " session" + (nSess === 1 ? "" : "s") +
          (weeks ? " over " + weeks + " week" + (weeks === 1 ? "" : "s") : "");
        if (series.length >= 2) {
          var delta = Math.round((series[series.length - 1].e1rm - series[0].e1rm) * 10) / 10;
          bits.sub += " · " + U.fmtWeightDelta(delta) + " across the series";
          bits.bodyHtml = receiptSparkline(series.map(function (p, i) {
            var x = dn(p.day);
            return { x: x != null ? x : i, y: p.e1rm };
          }));
        }
      }
    } else if (r.type === "consistency") {
      var weeksArr = Array.isArray(r.weeks) ? r.weeks : [];
      var planned = 0, done = 0;
      weeksArr.forEach(function (w) {
        if (!w || num(w.planned) == null) return;
        planned += w.planned;
        if (num(w.done) != null) done += Math.min(w.done, w.planned);
      });
      bits.title = "Consistency";
      if (planned > 0) bits.metric = Math.round(100 * done / planned) + "% of planned workouts";
      bits.sub = weeksArr.length + " week" + (weeksArr.length === 1 ? "" : "s") + " tracked";
      var lastWeek = weeksArr[weeksArr.length - 1];
      if (weeksArr.length && weeksArr[0] && num(weeksArr[0].planned) != null &&
          lastWeek && num(lastWeek.planned) != null) {
        bits.sub += " · plan " + lastWeek.planned + "/wk" +
          (r.basis === "typical" ? " (from their own typical week)" : "");
      }
      if (num(r.streak) != null && r.streak > 1) bits.sub += " · " + r.streak + "-day streak";
      if (Array.isArray(r.days7) && r.days7.length) {
        bits.bodyHtml = '<div class="rc-days" aria-label="Last 7 days">' +
          r.days7.slice(0, 7).map(function (v) {
            return '<span class="rc-day' + (v ? " on" : "") + '"></span>';
          }).join("") + '</div>';
      }
    } else if (r.type === "progress") {
      bits.title = "Progress" + (r.metric === "weight" ? " — body weight" : "");
      if (num(r.start_value) != null && num(r.end_value) != null) {
        var pd = Math.round((r.end_value - r.start_value) * 10) / 10;
        var arrow = pd > 0 ? "↑ " : pd < 0 ? "↓ " : "→ ";
        bits.metric = arrow + U.fmtWeightDelta(pd);
        bits.sub = U.fmtWeight(r.start_value, 1) + " → " + U.fmtWeight(r.end_value, 1) +
          (num(r.days) != null ? " in " + r.days + " days" : "");
      }
      var m = r.maintenance;
      if (m && typeof m === "object" && num(m.learned_kcal) != null) {
        bits.bodyHtml = '<div class="soc-receipt-sub muted small">Learned maintenance ~' +
          Math.round(m.learned_kcal) + " kcal" +
          (num(m.formula_kcal) != null ? " vs formula " + Math.round(m.formula_kcal) + " kcal" : "") +
          '</div>';
      }
    } else if (r.type === "weekly") {
      bits.title = "This week";
      if (num(r.workouts) != null) bits.metric = r.workouts + " workout" + (r.workouts === 1 ? "" : "s");
      var stats = [];
      if (num(r.total_volume_kg) != null) {
        stats.push((U.toDisplayWeight(r.total_volume_kg, 0) || 0).toLocaleString() + " " +
          U.weightUnit() + " volume");
      }
      if (num(r.total_sets) != null) stats.push(r.total_sets + " sets");
      if (num(r.sleep_avg_h) != null) stats.push("sleep avg " + r.sleep_avg_h + "h");
      if (r.best_lift && typeof r.best_lift === "object" &&
          typeof r.best_lift.name === "string" && num(r.best_lift.trend_pct_wk) != null) {
        stats.push(r.best_lift.name.slice(0, 50) + " " +
          (r.best_lift.trend_pct_wk > 0 ? "+" : "") + r.best_lift.trend_pct_wk + "%/wk");
      }
      if (stats.length) {
        bits.bodyHtml = '<div class="rc-stats">' + stats.map(function (s) {
          return '<span class="mini-stat">' + U.esc(s) + '</span>';
        }).join("") + '</div>';
      }
    }
    return bits;
  }

  /** Inline SVG sparkline for a receipt e1RM series (numbers only). */
  function receiptSparkline(pts) {
    if (!pts || pts.length < 2) return "";
    var W = 240, H = 56, P = 5;
    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x1 === x0) x1 = x0 + 1;
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    var poly = pts.map(function (p) {
      var x = P + (p.x - x0) / (x1 - x0) * (W - 2 * P);
      var y = P + (1 - (p.y - y0) / (y1 - y0)) * (H - 2 * P);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    return '<svg class="rc-spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="xMidYMid meet" ' +
      'aria-hidden="true"><polyline points="' + poly + '" fill="none" style="stroke:var(--accent-2)" ' +
      'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /** The receipt stat block (shared with the composer preview). */
  function receiptBlockHtml(receipt, verified) {
    var b = receiptBits(receipt);
    return '<div class="soc-receipt">' +
      '<div class="soc-receipt-head">' +
      (verified
        ? '<span class="soc-verified">' + OF.icons.get("check") + ' Verified by data</span>'
        : '<span class="soc-receipt-tag">Receipt</span>') +
      '<span class="soc-receipt-type">' + U.esc(b.title) + '</span></div>' +
      (b.metric ? '<div class="soc-receipt-metric grad-text">' + U.esc(b.metric) + '</div>' : "") +
      (b.bodyHtml || "") +
      (b.sub ? '<div class="soc-receipt-sub muted small">' + U.esc(b.sub) + '</div>' : "") +
      '</div>';
  }

  function receiptHtml(row) {
    return receiptBlockHtml(row.receipt, !!row.verified);
  }

  function commentRowHtml(c, postAuthorId) {
    var me = A.uid();
    var canDelete = c.author_id === me || postAuthorId === me;
    var author = c.author || {};
    return '<div class="soc-cmt">' +
      avatarHtml(author.avatar_url, author.username, "soc-ava-xs") +
      '<div class="soc-cmt-body"><span class="soc-cmt-name">' +
      U.esc(author.username ? "@" + author.username : "user") + '</span> ' +
      '<span class="soc-cmt-text">' + U.esc(c.body) + '</span>' +
      '<span class="soc-cmt-time muted">' + U.esc(relTime(c.created_at)) + '</span></div>' +
      '<span class="soc-cmt-btns">' +
      (c.author_id !== me
        ? '<button type="button" class="soc-cmt-act" data-act="cmt-report" data-arg="' +
          U.esc(c.id) + '" aria-label="Report comment" title="Report comment">!</button>'
        : "") +
      (canDelete
        ? '<button type="button" class="soc-cmt-act" data-act="cmt-del" data-arg="' +
          U.esc(c.id) + '" data-post-id="' + U.esc(c.post_id) +
          '" aria-label="Delete comment" title="Delete comment">&times;</button>'
        : "") +
      '</span></div>';
  }

  function commentsHtml(row) {
    var cs = comments[row.id];
    var html = '<div class="soc-cmts" data-cmts-box="' + U.esc(row.id) + '">';
    if (cs && cs.rows.length) {
      var shown = cs.expanded ? cs.rows : cs.rows.slice(-3);
      if (!cs.expanded && row.comment_count > shown.length) {
        html += '<button type="button" class="soc-cmts-more" data-act="cmts-expand" data-arg="' +
          U.esc(row.id) + '">View all ' + Number(row.comment_count) + ' comments</button>';
      }
      html += shown.map(function (c) { return commentRowHtml(c, row.author_id); }).join("");
    }
    if (A.uid()) {
      html += '<form class="soc-cmt-form" data-cmt-form="' + U.esc(row.id) + '">' +
        '<input type="text" maxlength="500" placeholder="Add a comment&hellip;" ' +
        'aria-label="Add a comment">' +
        '<button type="submit" class="btn mini">Post</button></form>';
    }
    return html + '</div>';
  }

  function postCardHtml(row) {
    var isReceipt = row.kind === "receipt";
    var kindTag = kindLabel(row.kind);
    var html = '<article class="soc-post card' + (isReceipt ? " soc-post-receipt" : "") +
      '" data-post="' + U.esc(row.id) + '">';
    html += '<div class="soc-post-head">' +
      '<button type="button" class="soc-user" data-act="user" data-arg="' + U.esc(row.author_id) + '">' +
      avatarHtml(row.avatar_url, row.username, "") +
      '<span class="soc-user-names"><span class="soc-user-name">' +
      U.esc(row.display_name || "@" + (row.username || "user")) + '</span>' +
      (row.display_name ? '<span class="soc-user-handle muted">@' + U.esc(row.username || "user") + '</span>' : "") +
      '</span></button>' +
      '<span class="soc-time muted">' + U.esc(relTime(row.created_at)) + '</span>' +
      '<button type="button" class="soc-menu-btn" data-act="menu" data-arg="' + U.esc(row.id) +
      '" aria-label="Post options">&#8943;</button></div>';

    if (isReceipt) html += receiptHtml(row);
    if (row.image_path) {
      html += '<div class="soc-img-wrap"><img class="soc-img" loading="lazy" alt="Post photo" src="' +
        U.esc(A.publicUrl("post-images", row.image_path)) + '"></div>';
    }
    if (row.caption) {
      html += '<p class="soc-caption">' + U.esc(row.caption) + '</p>';
    }
    if (row.hidden === true) {
      html += '<p class="soc-hidden-note muted small">Hidden after reports &mdash; only you can see this post.</p>';
    }
    html += '<div class="soc-post-actions">' +
      '<button type="button" class="soc-act' + (row.liked_by_me ? " liked" : "") +
      '" data-act="like" data-arg="' + U.esc(row.id) + '" aria-label="Like">' +
      OF.icons.get("heart") + '<span class="soc-act-n">' + Number(row.like_count || 0) + '</span></button>' +
      '<button type="button" class="soc-act" data-act="cmts-expand" data-arg="' + U.esc(row.id) +
      '" aria-label="Comments">' + OF.icons.get("chat") +
      '<span class="soc-act-n">' + Number(row.comment_count || 0) + '</span></button>' +
      (kindTag && !isReceipt ? '<span class="soc-kind">' + U.esc(kindTag) + '</span>' : "") +
      '</div>';
    html += commentsHtml(row);
    return html + '</article>';
  }

  function refreshCard(id) {
    var row = getPost(id);
    if (!row) return;
    document.querySelectorAll('[data-post="' + id + '"]').forEach(function (node) {
      var tmp = document.createElement("div");
      tmp.innerHTML = postCardHtml(row);
      node.replaceWith(tmp.firstChild);
    });
  }

  /** Update ONLY the like button + count in place (all copies of the card).
      Tapping like must never re-render the whole card, which would wipe an
      in-progress inline comment draft the user is typing. */
  function updateLikeUi(id) {
    var row = getPost(id);
    if (!row) return;
    document.querySelectorAll('[data-post="' + id + '"] [data-act="like"]').forEach(function (btn) {
      btn.classList.toggle("liked", !!row.liked_by_me);
      var n = btn.querySelector(".soc-act-n");
      if (n) n.textContent = Number(row.like_count || 0);
    });
  }

  /** One query for the newest comments across a page of posts. */
  function preloadComments(rows) {
    var withCmts = (rows || []).filter(function (r) {
      return r.comment_count > 0 && !comments[r.id];
    });
    if (!withCmts.length) return Promise.resolve();
    return Promise.all(withCmts.map(function (r) {
      return A.getComments(r.id, { limit: 3 }).then(function (cs) {
        comments[r.id] = { rows: cs, expanded: false };
      }).catch(function () { /* leave collapsed */ });
    }));
  }

  /* ================= community tab rendering ================= */

  function render() {
    if (!els.root) return;
    var html = "";
    if (st.state === "loading") {
      html = '<div class="card soc-center"><p class="muted">Loading community&hellip;</p></div>';
    } else if (st.state === "nolib") {
      html = '<div class="card placeholder-card"><h2>Community unavailable</h2>' +
        '<p class="muted">The community library did not load. The rest of the app works normally.</p></div>';
    } else if (st.state === "offline") {
      html = '<div class="card placeholder-card"><h2>You&rsquo;re offline</h2>' +
        '<p class="muted">The community needs an internet connection. Everything else in the app ' +
        'keeps working offline &mdash; your tracking data lives on this device.</p>' +
        '<div class="form-actions"><button type="button" class="btn" data-act="retry">Try again</button></div></div>';
    } else if (st.state === "out") {
      html = pitchHtml();
    } else if (st.state === "emailsent") {
      html = '<div class="card soc-pitch"><h2>Check your email</h2>' +
        '<p class="muted">We sent a confirmation link to <strong>' + U.esc(st.pendingEmail || "your inbox") +
        '</strong>. Tap it, then come back here and sign in.</p>' +
        '<div class="form-actions"><button type="button" class="btn primary" data-act="auth-open" data-arg="signin">Sign in</button></div></div>';
    } else if (st.state === "setup") {
      html = setupHtml();
    } else if (st.state === "in") {
      html = mainHtml();
    }
    els.root.innerHTML = html;
    if (st.state === "setup") bindSetupForm();
    if (st.state === "in") {
      renderFeedInto(document.getElementById("soc-feed"));
      bindFeedSentinel();
    }
    renderSettingsCard();
  }

  function pitchHtml() {
    return '<div class="card soc-pitch">' +
      '<div class="soc-pitch-badge">' + OF.icons.get("sparkles") + '</div>' +
      '<h2>OptimalFit Community</h2>' +
      '<p class="muted">Share workouts, meals and progress photos, follow friends, ' +
      'check in at your gym and climb honest leaderboards &mdash; built on showing up, not typing big numbers.</p>' +
      '<ul class="soc-pitch-list muted">' +
      '<li><strong>Your tracking data stays on your device.</strong> You choose every single post &mdash; nothing is uploaded automatically.</li>' +
      '<li>Leaderboards count real daily check-ins, so the only way to win is to show up.</li>' +
      '<li>Report and block tools are one tap away. No ads, no tracking.</li>' +
      '</ul>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn primary" data-act="auth-open" data-arg="signup">Create account</button>' +
      '<button type="button" class="btn" data-act="auth-open" data-arg="signin">Sign in</button>' +
      '</div></div>';
  }

  function setupHtml() {
    return '<div class="card soc-pitch"><h2>Pick your username</h2>' +
      '<p class="muted small">3&ndash;20 characters: lowercase letters, numbers and underscores. ' +
      'This is how other members see you.</p>' +
      '<form id="soc-setup-form" novalidate>' +
      '<div class="form-row"><label>Username' +
      '<input type="text" id="soc-setup-username" maxlength="20" autocomplete="off" ' +
      'autocapitalize="none" spellcheck="false" placeholder="e.g. iron_anna"></label>' +
      '<label>Display name (optional)' +
      '<input type="text" id="soc-setup-display" maxlength="50" placeholder="e.g. Anna"></label></div>' +
      '<p class="form-hint" id="soc-setup-avail"></p>' +
      (st.tosAccepted ? '<p class="muted small">Terms accepted at sign-up &#10003;</p>' :
        '<label class="soc-check"><input type="checkbox" id="soc-setup-age"> I&rsquo;m 13 or older</label>' +
        '<label class="soc-check"><input type="checkbox" id="soc-setup-tos"> I accept the ' +
        '<button type="button" class="soc-link" data-act="terms-open">Terms</button></label>') +
      '<p class="form-error" id="soc-setup-error" hidden></p>' +
      '<div class="form-actions">' +
      '<button type="submit" class="btn primary" id="soc-setup-submit">Join the community</button>' +
      '<button type="button" class="btn ghost" data-act="signout">Sign out</button>' +
      '</div></form></div>';
  }

  function mainHtml() {
    var p = st.profile || {};
    var gym = st.gyms[0];
    var checkinLabel = st.checkedToday
      ? OF.icons.get("check") + '<span>Checked in' + (st.streak > 1 ? " · " + st.streak + "-day streak" : "") + '</span>'
      : OF.icons.get("flame") + '<span>Check in today</span>';
    var banner = "";
    if (OF.receipts) {
      try { banner = OF.receipts.bannerHtml(); } catch (e) { banner = ""; }
    }
    return banner + '<div class="soc-top">' +
      '<button type="button" class="soc-me" data-act="user" data-arg="' + U.esc(p.id || "") + '">' +
      avatarHtml(p.avatar_url, p.username, "") +
      '<span class="soc-me-names"><strong>' + U.esc(displayNameOf(p)) + '</strong>' +
      '<span class="muted small">@' + U.esc(p.username || "") + '</span></span></button>' +
      '<button type="button" class="btn mini" data-act="compose-open">' + OF.icons.get("plus") + ' Share</button>' +
      '</div>' +

      '<div class="soc-quick">' +
      '<button type="button" class="soc-quick-btn' + (st.checkedToday ? " done" : "") +
      '" data-act="checkin"' + (st.checkinBusy ? " disabled" : "") + '>' + checkinLabel + '</button>' +
      '<button type="button" class="soc-quick-btn" data-act="gym-open">' + OF.icons.get("dumbbell") +
      '<span>' + (gym ? U.esc(gym.name) : "Pick your gym") + '</span></button>' +
      '<button type="button" class="soc-quick-btn" data-act="lb-open">' + OF.icons.get("trend") +
      '<span>Leaderboards</span></button>' +
      '</div>' +

      '<div class="soc-feed-bar" role="tablist" aria-label="Feed">' +
      '<button type="button" role="tab" aria-selected="' + (st.feedMode === "home") +
      '" class="soc-feed-tab' + (st.feedMode === "home" ? " active" : "") +
      '" data-act="feed-mode" data-arg="home">Home</button>' +
      '<button type="button" role="tab" aria-selected="' + (st.feedMode === "discover") +
      '" class="soc-feed-tab' + (st.feedMode === "discover" ? " active" : "") +
      '" data-act="feed-mode" data-arg="discover">Discover</button></div>' +

      '<div id="soc-feed"></div>' +
      '<div class="soc-more" id="soc-more">' +
      '<button type="button" class="btn" data-act="feed-more" id="soc-more-btn">Load more</button></div>';
  }

  function feedEmptyHtml() {
    if (st.feedMode === "home") {
      return '<div class="empty-state"><span class="ico-badge">' + OF.icons.get("heart") + '</span>' +
        '<p>Your Home feed shows you and people you follow. ' +
        'Head to <strong>Discover</strong> to find people, or share your first post.</p></div>';
    }
    return '<div class="empty-state"><span class="ico-badge">' + OF.icons.get("sparkles") + '</span>' +
      '<p>No posts yet &mdash; be the first to share something.</p></div>';
  }

  /** Group receipt posts from the current drop week (since Sunday, local)
      under a "This week's drop" header. Pure client-side grouping by
      created_at; non-receipt posts keep their order below. */
  function groupedFeedHtml() {
    var wkStart = null;
    if (OF.receipts) {
      try { wkStart = OF.receipts.weekStartISO(); } catch (e) { wkStart = null; }
    }
    if (!wkStart) return st.feed.map(postCardHtml).join("");
    var drop = [], rest = [];
    st.feed.forEach(function (r) {
      if (r.kind === "receipt" && localDateOf(r.created_at) >= wkStart) drop.push(r);
      else rest.push(r);
    });
    if (!drop.length) return st.feed.map(postCardHtml).join("");
    return '<div class="soc-drop-head">' + OF.icons.get("sparkles") + ' This week&rsquo;s drop</div>' +
      drop.map(postCardHtml).join("") +
      (rest.length ? '<div class="soc-drop-head soc-drop-rest">Earlier</div>' + rest.map(postCardHtml).join("") : "");
  }

  function renderFeedInto(box) {
    if (!box) return;
    // [13] preserve a comment the user is mid-typing across a feed rebuild
    // (auto-pagination / check-in refresh) — snapshot the focused draft first.
    var draft = null;
    var af = document.activeElement;
    if (af && af.matches && af.matches(".soc-cmt-form input") && box.contains(af)) {
      var form = af.closest(".soc-cmt-form");
      draft = { id: form && form.getAttribute("data-cmt-form"),
                value: af.value, start: af.selectionStart, end: af.selectionEnd };
    }
    var html = groupedFeedHtml();
    if (!st.feed.length && !st.feedLoading) html = st.feedError
      ? '<div class="card placeholder-card"><p class="muted">' + U.esc(st.feedError) + '</p>' +
        '<div class="form-actions"><button type="button" class="btn" data-act="feed-retry">Try again</button></div></div>'
      : feedEmptyHtml();
    if (st.feedLoading && !st.feed.length) {
      html = '<div class="soc-center muted">Loading posts&hellip;</div>';
    }
    box.innerHTML = html;
    if (draft && draft.id) {
      var re = box.querySelector('.soc-cmt-form[data-cmt-form="' + (window.CSS && CSS.escape ? CSS.escape(draft.id) : draft.id) + '"] input');
      if (re) {
        re.value = draft.value;
        try { re.focus(); re.setSelectionRange(draft.start, draft.end); } catch (e) {}
      }
    }
    var more = document.getElementById("soc-more");
    if (more) more.classList.toggle("hidden", st.feedDone || !st.feed.length);
    var moreBtn = document.getElementById("soc-more-btn");
    if (moreBtn) {
      moreBtn.disabled = st.feedLoading;
      moreBtn.textContent = st.feedLoading ? "Loading…" : "Load more";
    }
  }

  var observer = null;
  function bindFeedSentinel() {
    if (!("IntersectionObserver" in window)) return;
    if (observer) observer.disconnect();
    var more = document.getElementById("soc-more");
    if (!more) return;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !st.feedLoading && !st.feedDone && st.feed.length) loadFeed(false);
      });
    }, { rootMargin: "600px" });
    observer.observe(more);
  }

  /* ================= data loading ================= */

  function boot() {
    if (!A.available()) { st.state = "nolib"; render(); return; }
    A.init().then(function (user) {
      if (!user) {
        st.state = "out";
        st.profile = null;
        render();
        return;
      }
      return A.getMyProfile().then(function (p) {
        if (!p) {
          st.state = "setup";
          render();
          return;
        }
        st.profile = p;
        st.state = "in";
        render();
        loadFeed(true);
        loadGyms();
        loadCheckins();
      });
    }).catch(function (e) {
      var err = e && e.message ? e : A.normErr(e);
      if (err.offline) {
        // show cached identity if we have one, but the tab needs network
        st.state = "offline";
        render();
      } else if (err.authExpired) {
        A.signOut().then(function () { st.state = "out"; render(); });
      } else {
        st.state = "offline";
        render();
      }
    });
  }

  var feedSeq = 0; // stale responses (e.g. after a Home↔Discover switch) are dropped
  function loadFeed(reset) {
    if (st.feedLoading && !reset) return;
    if (reset) { st.feed = []; st.feedDone = false; st.feedError = ""; }
    var seq = ++feedSeq;
    st.feedLoading = true;
    renderFeedInto(document.getElementById("soc-feed"));
    var before = st.feed.length ? st.feed[st.feed.length - 1].created_at : null;
    var call = st.feedMode === "home" ? A.getHomeFeed(20, before) : A.getDiscoverFeed(20, before);
    call.then(function (rows) {
      if (seq !== feedSeq) return;
      rows = rows || [];
      registerPosts(rows);
      st.feed = st.feed.concat(rows);
      if (rows.length < 20) st.feedDone = true;
      return preloadComments(rows);
    }).catch(function (e) {
      if (seq !== feedSeq) return;
      st.feedError = (e && e.offline)
        ? "You look offline — posts will load once you're back online."
        : "Couldn't load posts right now.";
      if (e && e.authExpired) { handleErr(e); return; }
    }).then(function () {
      if (seq !== feedSeq) return;
      st.feedLoading = false;
      renderFeedInto(document.getElementById("soc-feed"));
    });
  }

  function loadGyms() {
    A.myGyms().then(function (gyms) {
      st.gyms = gyms || [];
      if (st.state === "in") render();
    }).catch(function () { /* non-fatal */ });
  }

  function utcToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function computeStreak(days) {
    // consecutive UTC days ending today or yesterday
    var set = {};
    days.forEach(function (d) { set[d] = true; });
    var cur = new Date();
    var iso = cur.toISOString().slice(0, 10);
    if (!set[iso]) cur.setUTCDate(cur.getUTCDate() - 1);
    var streak = 0;
    for (;;) {
      var k = cur.toISOString().slice(0, 10);
      if (!set[k]) break;
      streak++;
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
    return streak;
  }

  function loadCheckins() {
    A.getMyCheckIns(90).then(function (rows) {
      st.checkins = rows || [];
      var days = st.checkins.map(function (r) { return r.day; });
      st.checkedToday = days.indexOf(utcToday()) !== -1;
      st.streak = computeStreak(days);
      if (st.state === "in") render();
    }).catch(function () { /* non-fatal */ });
  }

  /* ================= auth sheets ================= */

  function openAuthSheet(mode) {
    st.authMode = mode || "signin";
    st.authError = "";
    renderAuthSheet();
  }

  function renderAuthSheet() {
    var isUp = st.authMode === "signup";
    var html = '<h2>' + (isUp ? "Create your account" : "Welcome back") + '</h2>' +
      (isUp ? '<p class="muted small soc-auth-note">Community posts are public to other members. ' +
        'Your tracking data stays on your device &mdash; you choose every post.</p>' : "") +
      '<form id="soc-auth-form" novalidate>' +
      '<div class="form-row"><label class="grow">Email' +
      '<input type="email" id="soc-auth-email" autocomplete="email" required placeholder="you@example.com"></label></div>' +
      '<div class="form-row"><label class="grow">Password' +
      '<input type="password" id="soc-auth-pass" autocomplete="' + (isUp ? "new-password" : "current-password") +
      '" required minlength="8" placeholder="' + (isUp ? "8+ characters" : "your password") + '"></label></div>' +
      (isUp
        ? '<label class="soc-check"><input type="checkbox" id="soc-auth-age"> I&rsquo;m 13 or older</label>' +
          '<label class="soc-check"><input type="checkbox" id="soc-auth-tos"> I accept the ' +
          '<button type="button" class="soc-link" data-act="terms-open">Terms</button></label>'
        : "") +
      '<p class="form-error" id="soc-auth-error"' + (st.authError ? "" : " hidden") + '>' +
      U.esc(st.authError) + '</p>' +
      '<div class="form-actions">' +
      '<button type="submit" class="btn primary" id="soc-auth-submit"' + (st.authBusy ? " disabled" : "") + '>' +
      (st.authBusy ? "Working…" : (isUp ? "Create account" : "Sign in")) + '</button>' +
      '<button type="button" class="btn ghost" data-close-social="1">Cancel</button></div>' +
      '<p class="muted small soc-auth-switch">' +
      (isUp ? 'Already have an account? <button type="button" class="soc-link" data-act="auth-switch" data-arg="signin">Sign in</button>'
            : 'New here? <button type="button" class="soc-link" data-act="auth-switch" data-arg="signup">Create an account</button>') +
      '</p></form>';
    sheetOpen(1, html, "soc-auth-panel");
    var form = document.getElementById("soc-auth-form");
    if (form) form.addEventListener("submit", onAuthSubmit);
  }

  function authFail(msg) {
    st.authBusy = false;
    st.authError = msg;
    // preserve typed values across re-render
    var em = document.getElementById("soc-auth-email");
    var pw = document.getElementById("soc-auth-pass");
    var emv = em ? em.value : "", pwv = pw ? pw.value : "";
    renderAuthSheet();
    var em2 = document.getElementById("soc-auth-email");
    var pw2 = document.getElementById("soc-auth-pass");
    if (em2) em2.value = emv;
    if (pw2) pw2.value = pwv;
  }

  function friendlyAuthError(e) {
    var m = (e && e.message) || "";
    if (e && e.offline) return m;
    if (/invalid login credentials/i.test(m)) return "That email or password didn't match.";
    if (/email not confirmed/i.test(m)) return "Please confirm your email first — check your inbox for our link.";
    if (/already registered/i.test(m)) return "That email already has an account — try signing in instead.";
    if (/at least|password should/i.test(m)) return "Please use a password with at least 8 characters.";
    if (/rate limit|too many/i.test(m)) return "Too many attempts — wait a minute and try again.";
    if (/invalid.*email|unable to validate/i.test(m)) return "That doesn't look like a valid email address.";
    return m || "Something went wrong — please try again.";
  }

  function onAuthSubmit(e) {
    e.preventDefault();
    if (st.authBusy) return;
    var email = (document.getElementById("soc-auth-email").value || "").trim();
    var pass = document.getElementById("soc-auth-pass").value || "";
    var isUp = st.authMode === "signup";
    if (!email || email.indexOf("@") === -1) { authFail("Please enter your email address."); return; }
    if (pass.length < 8) { authFail("Your password needs at least 8 characters."); return; }
    if (isUp) {
      var age = document.getElementById("soc-auth-age");
      var tos = document.getElementById("soc-auth-tos");
      if (!age || !age.checked) { authFail("Please confirm you're 13 or older."); return; }
      if (!tos || !tos.checked) { authFail("Please read and accept the Terms to continue."); return; }
    }
    st.authBusy = true;
    st.authError = "";
    renderAuthSheetBusy();

    if (isUp) {
      A.signUp(email, pass).then(function (res) {
        st.authBusy = false;
        st.tosAccepted = true;
        sheetClose(1);
        if (res.session) {
          boot(); // -> profile setup state
        } else {
          st.pendingEmail = email;
          st.state = "emailsent";
          render();
        }
      }).catch(function (err) { authFail(friendlyAuthError(err)); });
    } else {
      A.signIn(email, pass).then(function () {
        st.authBusy = false;
        sheetClose(1);
        st.state = "loading";
        render();
        boot();
      }).catch(function (err) { authFail(friendlyAuthError(err)); });
    }
  }

  function renderAuthSheetBusy() {
    var btn = document.getElementById("soc-auth-submit");
    if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
  }

  function openTermsSheet() {
    var html = '<h2>Community terms &mdash; the short version</h2>' +
      '<div class="soc-terms">' +
      '<p><strong>Be decent.</strong> No harassment, hate, nudity, spam, impersonation, or dangerous ' +
      'advice (extreme diets, doping). Content that gets reported by multiple members is hidden automatically.</p>' +
      '<p><strong>Your content.</strong> You own what you post and you can delete any post, comment, or your ' +
      'whole account at any time. Only things you explicitly publish ever leave your device &mdash; ' +
      'your tracking logs stay local.</p>' +
      '<p><strong>13+.</strong> You must be at least 13 years old to use the community.</p>' +
      '<p><strong>Not medical advice.</strong> Posts, benchmarks and leaderboards are other people&rsquo;s ' +
      'experiences, not guidance. Talk to a professional before changing your training or diet.</p>' +
      '<p><strong>Moderation.</strong> Use Report on any post, comment or profile. Blocking someone hides ' +
      'you both from each other. We may remove content or accounts that break these rules.</p>' +
      '<p class="muted small">This is a summary. The full Terms of Service and Privacy Policy ship with the app ' +
      'and are published on the store listing (see Settings &rarr; Community).</p>' +
      '</div>' +
      '<div class="form-actions"><button type="button" class="btn primary" data-close-social="2">Close</button></div>';
    sheetOpen(2, html, "soc-terms-panel");
  }

  /* ================= profile setup ================= */

  var availTimer = null;
  function bindSetupForm() {
    var form = document.getElementById("soc-setup-form");
    if (!form) return;
    var input = document.getElementById("soc-setup-username");
    var hint = document.getElementById("soc-setup-avail");
    input.addEventListener("input", function () {
      var v = input.value.trim().toLowerCase();
      input.value = v;
      if (availTimer) clearTimeout(availTimer);
      if (!v) { hint.textContent = ""; return; }
      if (!/^[a-z0-9_]{3,20}$/.test(v)) {
        hint.textContent = "3–20 chars: a–z, 0–9 and _ only.";
        return;
      }
      hint.textContent = "Checking availability…";
      availTimer = setTimeout(function () {
        A.usernameAvailable(v).then(function (free) {
          if (input.value !== v) return;
          hint.textContent = free ? "✓ @" + v + " is available" : "@" + v + " is taken — try another.";
        }).catch(function () { hint.textContent = ""; });
      }, 350);
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var errEl = document.getElementById("soc-setup-error");
      var showErr = function (m) { errEl.textContent = m; errEl.hidden = false; };
      var username = input.value.trim().toLowerCase();
      var display = (document.getElementById("soc-setup-display").value || "").trim();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        showErr("Usernames are 3–20 characters: lowercase letters, numbers, underscores.");
        return;
      }
      if (!st.tosAccepted) {
        var age = document.getElementById("soc-setup-age");
        var tos = document.getElementById("soc-setup-tos");
        if (!age || !age.checked) { showErr("Please confirm you're 13 or older."); return; }
        if (!tos || !tos.checked) { showErr("Please read and accept the Terms to continue."); return; }
      }
      var btn = document.getElementById("soc-setup-submit");
      btn.disabled = true;
      btn.textContent = "Joining…";
      A.createProfile(username, display).then(function (p) {
        st.profile = p;
        st.state = "in";
        render();
        loadFeed(true);
        loadGyms();
        loadCheckins();
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Join the community";
        if (err && err.conflict) showErr("@" + username + " is taken — try another.");
        else showErr(err && err.offline ? err.message : "Couldn't create your profile — " + (err.message || "try again."));
      });
    });
  }

  /* ================= check-in / gyms ================= */

  function doCheckIn() {
    if (st.checkinBusy) return;
    st.checkinBusy = true;
    render();
    var gym = st.gyms[0];
    A.checkIn(gym ? gym.id : null).then(function (res) {
      st.checkinBusy = false;
      if (res && res.already) {
        U.toast("Already checked in today — see you tomorrow!", "warn");
      } else {
        U.toast("Checked in! Keep the streak alive.", "warn");
      }
      loadCheckins();
      render();
    }).catch(function (e) {
      st.checkinBusy = false;
      render();
      handleErr(e, "Couldn't check in right now.");
    });
  }

  var gymSearchTimer = null;
  function openGymSheet() {
    renderGymSheet([], "");
    runGymSearch("");
  }

  /** Inner HTML of #soc-gym-results (search matches, excluding gyms you're
      already in). Kept separate so a search can update the list without
      touching the <input>. */
  function gymResultsHtml(results, query) {
    var out = (results || []).filter(function (g) {
      return !st.gyms.some(function (m) { return m.id === g.id; });
    }).map(function (g) {
      return '<div class="soc-gym-row"><span class="soc-gym-name">' + U.esc(g.name) + '</span>' +
        '<button type="button" class="btn mini" data-act="gym-join" data-arg="' + U.esc(g.id) +
        '" data-name="' + U.esc(g.name) + '">Join</button></div>';
    }).join("");
    return out || '<p class="muted small soc-gym-none">' +
      (query ? "No gyms match that name yet." : "No gyms yet — create the first one!") + '</p>';
  }

  /** Inner HTML of the #soc-gym-create slot (the "Create …" action, if the
      query names a gym that doesn't exist yet). */
  function gymCreateHtml(results, query) {
    var canCreate = query && query.trim().length >= 2 &&
      !(results || []).some(function (g) { return g.name.trim().toLowerCase() === query.trim().toLowerCase(); });
    return canCreate
      ? '<div class="form-actions"><button type="button" class="btn primary" data-act="gym-create" data-arg="' +
        U.esc(query.trim()) + '">Create &ldquo;' + U.esc(query.trim()) + '&rdquo;</button></div>'
      : "";
  }

  function renderGymSheet(results, query) {
    var mine = st.gyms.map(function (g) {
      return '<div class="soc-gym-row"><span class="soc-gym-name">' + U.esc(g.name) + '</span>' +
        '<button type="button" class="btn mini" data-act="gym-leave" data-arg="' + U.esc(g.id) + '">Leave</button></div>';
    }).join("");
    var html = '<h2>Your gym</h2>' +
      (mine ? '<div class="soc-gym-mine">' + mine + '</div>'
            : '<p class="muted small">Join a gym to check in there and unlock its leaderboard.</p>') +
      '<div class="form-row"><label class="grow">Find a gym' +
      '<input type="search" id="soc-gym-q" placeholder="Search by name&hellip;" autocomplete="off" value="' +
      U.esc(query || "") + '"></label></div>' +
      '<div class="soc-gym-list" id="soc-gym-results">' + gymResultsHtml(results, query) + '</div>' +
      '<div id="soc-gym-create">' + gymCreateHtml(results, query) + '</div>' +
      '<div class="form-actions"><button type="button" class="btn ghost" data-close-social="1">Done</button></div>';
    var panel = sheetOpen(1, html, "soc-gym-panel");
    var q = document.getElementById("soc-gym-q");
    if (q) {
      q.addEventListener("input", function () {
        var v = q.value;
        if (gymSearchTimer) clearTimeout(gymSearchTimer);
        gymSearchTimer = setTimeout(function () { runGymSearch(v); }, 300);
      });
      // focus once on open; subsequent searches never re-create this input
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
    return panel;
  }

  /** iOS: update ONLY the results list + create slot after a search. Never
      re-create/replace the <input> — replacing it drops characters typed
      during the debounce/network window and dismisses the WKWebView keyboard.
      Bails if the gym sheet is no longer the one on screen. */
  function updateGymResults(results, query) {
    var list = document.getElementById("soc-gym-results");
    if (!list) return;
    list.innerHTML = gymResultsHtml(results, query);
    var create = document.getElementById("soc-gym-create");
    if (create) create.innerHTML = gymCreateHtml(results, query);
  }

  function runGymSearch(query) {
    A.searchGyms(query.trim()).then(function (rows) {
      if (!sheetIsOpen(1)) return;
      updateGymResults(rows || [], query);
    }).catch(function (e) {
      if (e && e.authExpired) handleErr(e);
    });
  }

  /* ================= leaderboards ================= */

  function openLeaderboard() {
    st.lb = { scope: "friends", metric: "streak", rows: null, loading: false, error: "" };
    renderLbSheet();
    loadLb();
  }

  function lbMetricLabel(m) {
    return m === "days7" ? "Last 7 days" :
      m === "days28" ? "Last 28 days" :
      m === "receipts" ? "Verified receipts" : "Check-in streak";
  }

  function renderLbSheet() {
    var scopes = [{ id: "friends", label: "Friends" }].concat(st.gyms.map(function (g) {
      return { id: "gym:" + g.id, label: g.name };
    }));
    var metrics = ["streak", "days7", "days28", "receipts"];
    var body;
    if (st.lb.loading) {
      body = '<p class="muted soc-center">Loading board&hellip;</p>';
    } else if (st.lb.error) {
      body = '<p class="form-error">' + U.esc(st.lb.error) + '</p>';
    } else if (!st.lb.rows || !st.lb.rows.length) {
      body = '<div class="empty-state"><span class="ico-badge">' + OF.icons.get("trend") + '</span><p>' +
        (st.lb.scope === "friends"
          ? "Nothing here yet — follow people and check in daily to build this board."
          : "No check-ins at this gym yet — be the first!") + '</p></div>';
    } else {
      var me = A.uid();
      body = '<div class="soc-lb-rows">' + st.lb.rows.map(function (r) {
        return '<div class="soc-lb-row' + (r.user_id === me ? " me" : "") + '">' +
          '<span class="soc-lb-rank">' + Number(r.rank) + '</span>' +
          avatarHtml(r.avatar_url, r.username, "soc-ava-sm") +
          '<button type="button" class="soc-lb-name soc-link" data-act="user" data-arg="' + U.esc(r.user_id) + '">' +
          U.esc(r.display_name || "@" + (r.username || "user")) + '</button>' +
          '<span class="soc-lb-val">' + Number(r.value) +
          (st.lb.metric === "streak" ? "d" : "") + '</span></div>';
      }).join("") + '</div>';
    }
    var html = '<h2>Leaderboards</h2>' +
      '<div class="soc-feed-bar soc-lb-scopes">' + scopes.map(function (s) {
        return '<button type="button" class="soc-feed-tab' + (st.lb.scope === s.id ? " active" : "") +
          '" data-act="lb-scope" data-arg="' + U.esc(s.id) + '">' + U.esc(s.label) + '</button>';
      }).join("") + '</div>' +
      '<div class="soc-lb-metrics">' + metrics.map(function (m) {
        return '<button type="button" class="coach-chip' + (st.lb.metric === m ? " soc-chip-on" : "") +
          '" data-act="lb-metric" data-arg="' + m + '">' + lbMetricLabel(m) + '</button>';
      }).join("") + '</div>' +
      body +
      '<p class="muted small">Boards count real daily check-ins and verified receipts &mdash; ' +
      'the only way up is showing up.</p>' +
      '<div class="form-actions"><button type="button" class="btn ghost" data-close-social="1">Close</button></div>';
    sheetOpen(1, html, "soc-lb-panel");
  }

  var lbSeq = 0; // drop stale responses after a rapid metric/scope switch
  function loadLb() {
    var seq = ++lbSeq;
    st.lb.loading = true;
    st.lb.error = "";
    renderLbSheet();
    var call;
    if (st.lb.scope === "friends") call = A.getFriendsLeaderboard(st.lb.metric);
    else call = A.getGymLeaderboard(st.lb.scope.slice(4), st.lb.metric);
    call.then(function (rows) {
      if (seq !== lbSeq) return;
      st.lb.rows = rows || [];
    }).catch(function (e) {
      if (seq !== lbSeq) return;
      st.lb.error = (e && e.offline) ? e.message : "Couldn't load that board right now.";
    }).then(function () {
      if (seq !== lbSeq) return;
      st.lb.loading = false;
      if (sheetIsOpen(1)) renderLbSheet();
    });
  }

  /* ================= post interactions ================= */

  function toggleLike(id) {
    var row = getPost(id);
    if (!row) return;
    var was = !!row.liked_by_me;
    row.liked_by_me = !was;
    row.like_count = Math.max(0, Number(row.like_count || 0) + (was ? -1 : 1));
    updateLikeUi(id);
    (was ? A.unlike(id) : A.like(id)).catch(function (e) {
      if (e && e.conflict) return; // idempotent — state already right
      row.liked_by_me = was;
      row.like_count = Math.max(0, Number(row.like_count || 0) + (was ? 1 : -1));
      updateLikeUi(id);
      handleErr(e, "Couldn't update that like.");
    });
  }

  function expandComments(id) {
    var row = getPost(id);
    if (!row) return;
    var cs = comments[id];
    if (cs && cs.expanded) { // collapse
      cs.expanded = false;
      refreshCard(id);
      return;
    }
    A.getComments(id, { limit: 100 }).then(function (rows) {
      comments[id] = { rows: rows, expanded: true };
      refreshCard(id);
      var box = document.querySelector('[data-post="' + id + '"] .soc-cmt-form input');
      if (box) box.focus();
    }).catch(function (e) { handleErr(e, "Couldn't load comments."); });
  }

  function submitComment(id, input) {
    var body = (input.value || "").trim().slice(0, 500);
    if (!body) return;
    input.disabled = true;
    A.addComment(id, body).then(function (c) {
      var row = getPost(id);
      if (!comments[id]) comments[id] = { rows: [], expanded: false };
      comments[id].rows.push(c);
      if (row) row.comment_count = Number(row.comment_count || 0) + 1;
      refreshCard(id);
    }).catch(function (e) {
      input.disabled = false;
      handleErr(e, "Couldn't post that comment.");
    });
  }

  function deleteCommentUi(commentId, postId) {
    A.deleteComment(commentId).then(function () {
      var cs = comments[postId];
      if (cs) cs.rows = cs.rows.filter(function (c) { return c.id !== commentId; });
      var row = getPost(postId);
      if (row) row.comment_count = Math.max(0, Number(row.comment_count || 0) - 1);
      refreshCard(postId);
    }).catch(function (e) { handleErr(e, "Couldn't delete that comment."); });
  }

  function openPostMenu(id) {
    var row = getPost(id);
    if (!row) return;
    var mine = row.author_id === A.uid();
    var html = '<h2>Post options</h2><div class="soc-menu-list">' +
      '<button type="button" class="soc-menu-item" data-act="user" data-arg="' + U.esc(row.author_id) + '">' +
      'View @' + U.esc(row.username || "user") + '&rsquo;s profile</button>' +
      (row.kind === "receipt" && mine && OF.receipts
        ? '<button type="button" class="soc-menu-item" data-act="receipt-share" data-arg="' + U.esc(id) + '">Share as image</button>'
        : "") +
      (mine
        ? '<button type="button" class="soc-menu-item danger" data-act="post-del" data-arg="' + U.esc(id) + '">Delete post</button>'
        : '<button type="button" class="soc-menu-item" data-act="report-open" data-arg="post:' + U.esc(id) + '">Report post</button>' +
          '<button type="button" class="soc-menu-item danger" data-act="block-open" data-arg="' + U.esc(row.author_id) +
          '" data-name="' + U.esc(row.username || "") + '">Block @' + U.esc(row.username || "user") + '</button>') +
      '</div><div class="form-actions"><button type="button" class="btn ghost" data-close-social="2">Cancel</button></div>';
    sheetOpen(2, html);
  }

  function deletePostUi(id) {
    if (!confirm("Delete this post? This can't be undone.")) return;
    sheetClose(2);
    A.deletePost(id).then(function () {
      removePostEverywhere(id);
      U.toast("Post deleted.", "warn");
    }).catch(function (e) { handleErr(e, "Couldn't delete that post."); });
  }

  /* ================= report / block (exported for profile too) ================= */

  var REPORT_REASONS = ["Spam", "Harassment or bullying", "Inappropriate content",
    "Impersonation", "Dangerous advice", "Something else"];

  /** target: "post:<id>" | "comment:<id>" | "user:<id>" */
  function openReportSheet(target) {
    var html = '<h2>Report</h2>' +
      '<p class="muted small">Tell us what&rsquo;s wrong. Reports are anonymous to the person reported.</p>' +
      '<div class="soc-report-reasons">' + REPORT_REASONS.map(function (r, i) {
        return '<label class="soc-check"><input type="radio" name="soc-report-reason" value="' +
          U.esc(r) + '"' + (i === 0 ? " checked" : "") + '> ' + U.esc(r) + '</label>';
      }).join("") + '</div>' +
      '<label class="photo-desc-label">Details (optional)' +
      '<textarea id="soc-report-text" maxlength="400" rows="2" placeholder="Anything that helps us review this"></textarea></label>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn primary" data-act="report-submit" data-arg="' + U.esc(target) + '">Send report</button>' +
      '<button type="button" class="btn ghost" data-close-social="2">Cancel</button></div>';
    sheetOpen(2, html);
  }

  function submitReport(target) {
    var picked = document.querySelector('input[name="soc-report-reason"]:checked');
    var text = (document.getElementById("soc-report-text") || {}).value || "";
    var reason = ((picked ? picked.value : "Report") + (text.trim() ? " — " + text.trim() : "")).slice(0, 500);
    var parts = target.split(":");
    var t = {};
    if (parts[0] === "post") t.postId = parts[1];
    else if (parts[0] === "comment") t.commentId = parts[1];
    else t.userId = parts[1];
    A.report(t, reason).then(function (res) {
      sheetClose(2);
      U.toast(res && res.already ? "You already reported this — thanks."
        : "Thanks — your report was sent.", "warn");
    }).catch(function (e) { handleErr(e, "Couldn't send that report."); });
  }

  function openBlockSheet(userId, username) {
    var handle = username ? "@" + username : "this user";
    var html = '<h2>Block ' + U.esc(handle) + '?</h2>' +
      '<p class="muted">You won&rsquo;t see each other&rsquo;s posts, comments or profiles, and any ' +
      'follows between you are removed. They won&rsquo;t be told. You can unblock later from ' +
      'Settings &rarr; Community.</p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn danger" data-act="block-confirm" data-arg="' + U.esc(userId) +
      '" data-name="' + U.esc(username || "") + '">Block</button>' +
      '<button type="button" class="btn ghost" data-close-social="2">Cancel</button></div>';
    sheetOpen(2, html);
  }

  function confirmBlock(userId, username) {
    A.block(userId, username).then(function () {
      sheetClose(2);
      sheetClose(1); // their profile sheet, if open
      // scrub their content from the loaded feed immediately
      st.feed.filter(function (r) { return r.author_id === userId; })
        .forEach(function (r) { removePostEverywhere(r.id); });
      U.toast("Blocked. You won't see each other anymore.", "warn");
      renderSettingsCard();
    }).catch(function (e) { handleErr(e, "Couldn't block right now."); });
  }

  /* ================= settings card ================= */

  function renderSettingsCard() {
    var box = els.settingsBox;
    if (!box) return;
    var user = A.currentUser();
    if (!A.available()) { box.innerHTML = ""; return; }
    if (!user) {
      box.innerHTML = '<div class="card"><h2>Community</h2>' +
        '<p class="muted small">You&rsquo;re not signed in. The community is optional &mdash; ' +
        'create an account from the <a href="#community">Community tab</a> if you&rsquo;d like to ' +
        'share posts and follow friends. Your tracking data always stays on this device.</p></div>';
      return;
    }
    var p = st.profile || A.cachedProfile() || {};
    box.innerHTML = '<div class="card"><h2>Community</h2>' +
      '<p class="muted small">Signed in as <strong>' + U.esc(user.email || "") + '</strong>' +
      (p.username ? ' (@' + U.esc(p.username) + ')' : "") + '</p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn" data-act="signout">Sign out</button>' +
      '<button type="button" class="btn" data-act="blocked-open">Blocked users</button>' +
      '<button type="button" class="btn" data-act="terms-open">Terms</button>' +
      '</div>' +
      '<p class="muted small">Full Terms of Service &amp; Privacy Policy are published on the app&rsquo;s ' +
      'store listing. Only content you explicitly post is stored on the community server.</p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn danger" data-act="delacct-open">Delete community account&hellip;</button>' +
      '</div></div>';
  }

  function openBlockedSheet() {
    sheetOpen(1, '<h2>Blocked users</h2><p class="muted soc-center">Loading&hellip;</p>');
    A.getBlocked().then(function (rows) {
      if (!sheetIsOpen(1)) return;
      var list = rows.length ? rows.map(function (r) {
        return '<div class="soc-gym-row"><span class="soc-gym-name">@' + U.esc(r.username) + '</span>' +
          '<button type="button" class="btn mini" data-act="unblock" data-arg="' + U.esc(r.userId) + '">Unblock</button></div>';
      }).join("") : '<div class="empty-state"><p>You haven&rsquo;t blocked anyone.</p></div>';
      sheetOpen(1, '<h2>Blocked users</h2><div class="soc-gym-list">' + list + '</div>' +
        '<div class="form-actions"><button type="button" class="btn ghost" data-close-social="1">Done</button></div>');
    }).catch(function (e) {
      sheetClose(1);
      handleErr(e, "Couldn't load your blocked list.");
    });
  }

  function openDeleteAccountSheet() {
    var html = '<h2>Delete community account</h2>' +
      '<p class="muted">This permanently deletes your community account and <strong>everything</strong> ' +
      'attached to it, on our servers:</p>' +
      '<ul class="plain-list muted small">' +
      '<li>your profile, username and avatar image</li>' +
      '<li>all posts, uploaded photos, likes and comments</li>' +
      '<li>follows, blocks, gym memberships, check-ins and streaks</li>' +
      '<li>your anonymized benchmark contributions</li></ul>' +
      '<p class="muted small">Your local tracking data (sleep, food, workouts&hellip;) is untouched &mdash; ' +
      'it never left this device. This cannot be undone.</p>' +
      '<label class="soc-check"><input type="checkbox" id="soc-del-sure"> I understand &mdash; delete everything</label>' +
      '<p class="form-error" id="soc-del-error" hidden></p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn danger" data-act="delacct-confirm">Delete my account</button>' +
      '<button type="button" class="btn ghost" data-close-social="1">Cancel</button></div>';
    sheetOpen(1, html);
  }

  function confirmDeleteAccount(btn) {
    var sure = document.getElementById("soc-del-sure");
    var errEl = document.getElementById("soc-del-error");
    if (!sure || !sure.checked) {
      errEl.textContent = "Tick the checkbox to confirm.";
      errEl.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Deleting…";
    A.deleteAccount().then(function () {
      sheetClose(1);
      st.profile = null;
      st.feed = [];
      st.state = "out";
      render();
      U.toast("Your community account was deleted. Your local data is untouched.", "warn");
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = "Delete my account";
      errEl.textContent = (e && e.offline) ? e.message : "Deletion failed — please try again.";
      errEl.hidden = false;
    });
  }

  /* ================= event wiring ================= */

  function onDelegatedClick(e) {
    var closer = e.target.closest("[data-close-social]");
    if (closer) {
      sheetClose(Number(closer.getAttribute("data-close-social")) || 1);
      return;
    }
    var t = e.target.closest("[data-act]");
    if (!t) return;
    var act = t.getAttribute("data-act");
    var arg = t.getAttribute("data-arg") || "";
    switch (act) {
      case "auth-open": openAuthSheet(arg); break;
      case "auth-switch": st.authMode = arg; st.authError = ""; renderAuthSheet(); break;
      case "terms-open": openTermsSheet(); break;
      case "retry": st.state = "loading"; render(); boot(); break;
      case "signout":
        A.signOut().then(function () {
          st.profile = null; st.feed = []; postReg = {}; comments = {};
          st.state = "out"; render();
        });
        break;
      case "compose-open": if (OF.socialCompose) OF.socialCompose.open(); break;
      case "compose-receipt":
        if (OF.socialCompose) OF.socialCompose.open({ kind: "receipt", receiptId: arg || null });
        break;
      case "receipt-share": {
        var rrow = getPost(arg);
        if (rrow && OF.receipts) OF.receipts.openShareSheet(rrow.receipt, !!rrow.verified, 2);
        break;
      }
      case "checkin": doCheckIn(); break;
      case "gym-open": openGymSheet(); break;
      case "gym-join":
        A.joinGym(arg).then(function () { loadGymsThen(openGymSheet); })
          .catch(function (err) { handleErr(err, "Couldn't join that gym."); });
        break;
      case "gym-leave":
        A.leaveGym(arg).then(function () { loadGymsThen(openGymSheet); })
          .catch(function (err) { handleErr(err, "Couldn't leave that gym."); });
        break;
      case "gym-create":
        A.createGym(arg).then(function (g) {
          if (!g) throw A.normErr(null);
          return A.joinGym(g.id);
        }).then(function () { loadGymsThen(openGymSheet); })
          .catch(function (err) { handleErr(err, "Couldn't create that gym."); });
        break;
      case "lb-open": openLeaderboard(); break;
      case "lb-scope": st.lb.scope = arg; loadLb(); break;
      case "lb-metric": st.lb.metric = arg; loadLb(); break;
      case "feed-mode":
        if (st.feedMode !== arg) {
          st.feedMode = arg;
          render();
          loadFeed(true);
        }
        break;
      case "feed-more": case "feed-retry": loadFeed(act === "feed-retry"); break;
      case "like": toggleLike(arg); break;
      case "cmts-expand": expandComments(arg); break;
      case "cmt-del": deleteCommentUi(arg, t.getAttribute("data-post-id")); break;
      case "cmt-report": openReportSheet("comment:" + arg); break;
      case "menu": openPostMenu(arg); break;
      case "post-del": deletePostUi(arg); break;
      case "report-open": sheetClose(2); openReportSheet(arg); break;
      case "report-submit": submitReport(arg); break;
      case "block-open": sheetClose(2); openBlockSheet(arg, t.getAttribute("data-name") || ""); break;
      case "block-confirm": confirmBlock(arg, t.getAttribute("data-name") || ""); break;
      case "user":
        if (OF.socialProfile && arg) OF.socialProfile.openUser(arg);
        break;
      case "blocked-open": openBlockedSheet(); break;
      case "unblock":
        A.unblock(arg).then(function () {
          U.toast("Unblocked.", "warn");
          openBlockedSheet();
        }).catch(function (err) { handleErr(err, "Couldn't unblock right now."); });
        break;
      case "delacct-open": openDeleteAccountSheet(); break;
      case "delacct-confirm": confirmDeleteAccount(t); break;
    }
  }

  function loadGymsThen(cb) {
    A.myGyms().then(function (gyms) {
      st.gyms = gyms || [];
      if (st.state === "in") render();
      if (cb) cb();
    }).catch(function () { if (cb) cb(); });
  }

  function onDelegatedSubmit(e) {
    var form = e.target.closest("[data-cmt-form]");
    if (form) {
      e.preventDefault();
      var input = form.querySelector("input");
      if (input) submitComment(form.getAttribute("data-cmt-form"), input);
    }
  }

  function init() {
    els.root = document.getElementById("community-root");
    els.sheet1 = document.getElementById("social-sheet");
    els.sheet2 = document.getElementById("social-sheet2");
    els.settingsBox = document.getElementById("community-settings");
    if (!els.root) return;

    [els.root, els.sheet1, els.sheet2, els.settingsBox].forEach(function (el) {
      if (!el) return;
      el.addEventListener("click", onDelegatedClick);
      el.addEventListener("submit", onDelegatedSubmit);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (sheetIsOpen(2)) sheetClose(2);
      else if (sheetIsOpen(1)) sheetClose(1);
    });

    if (A.available()) {
      A.onAuthChange(function () { renderSettingsCard(); });
    }
    render();     // loading state
    boot();
  }

  /** Called by app.js every time the Community tab is opened. */
  function onEnter() {
    if (st.state === "offline" || st.state === "nolib") boot();
    else if (st.state === "in" && !st.feed.length && !st.feedLoading) loadFeed(true);
  }

  /** Compose module calls this after publishing. */
  function onPosted() {
    st.feedMode = "home";
    render();
    loadFeed(true);
  }

  return {
    init: init,
    onEnter: onEnter,
    onPosted: onPosted,
    // shared with social-profile.js / social-compose.js
    sheetOpen: sheetOpen,
    sheetClose: sheetClose,
    relTime: relTime,
    avatarHtml: avatarHtml,
    postCardHtml: postCardHtml,
    receiptBlockHtml: receiptBlockHtml,
    registerPosts: registerPosts,
    preloadComments: preloadComments,
    openReportSheet: openReportSheet,
    openBlockSheet: openBlockSheet,
    handleErr: handleErr,
    refreshTab: function () { render(); },
    myProfile: function () { return st.profile; },
    setMyProfile: function (p) { st.profile = p; if (st.state === "in") render(); }
  };
})();
