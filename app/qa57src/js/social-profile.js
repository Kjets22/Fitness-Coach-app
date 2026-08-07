/* ============================================================
   social-profile.js — OF.socialProfile: public profile sheet
   (posts, follow/unfollow, report/block) + own-profile editor
   (display name, bio ≤300, avatar upload, optional local-stats
   line). Uses OF.social's sheet layers and post-card renderer;
   all interactivity on post cards is handled by social.js's
   delegated handler, so cards behave identically here.

   The "training stats" line is computed 100% locally from the
   user's exercise log and is shared ONLY while the toggle is on
   (it writes profiles.stats_summary; turning it off clears it).

   Avatar images reuse the food-photo.js approach: canvas
   re-encode to JPEG, max 512px, q0.85 (post images use 1600px
   via the same exported helper).
   ============================================================ */

window.OF = window.OF || {};

OF.socialProfile = (function () {
  "use strict";

  var U = OF.util;
  var A = OF.socialApi;
  var cur = null; // { userId, profile, counts, following, posts, done, loading, own }

  /* ---------------- image re-encode (shared w/ compose) ---------------- */

  function reencodeImage(file, maxSide, quality, cb) {
    var url;
    try { url = URL.createObjectURL(file); }
    catch (e) { cb(null, null, "That file could not be opened."); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error("empty image");
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) { cb(null, null, "That image could not be processed — try a JPEG or PNG photo."); return; }
          cb(blob, canvas.toDataURL("image/jpeg", quality), null);
        }, "image/jpeg", quality);
      } catch (e) {
        URL.revokeObjectURL(url);
        cb(null, null, "That image could not be processed — try a JPEG or PNG photo.");
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      cb(null, null, "Unsupported image — this browser could not read that file. Try a JPEG or PNG photo.");
    };
    img.src = url;
  }

  /* ---------------- local stats line ---------------- */

  /** "N-week streak · M workouts/wk" from the LOCAL exercise log (≤200 chars). */
  function computeStatsSummary() {
    var ex = (OF.storage && OF.storage.getAll) ? OF.storage.getAll("exercise") : [];
    if (!ex.length) return null;
    var byWeek = {};
    ex.forEach(function (r) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date || "");
      if (!m) return;
      var d = new Date(+m[1], +m[2] - 1, +m[3]);
      d.setDate(d.getDate() - d.getDay()); // week bucket: Sunday
      byWeek[d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()] = (byWeek[d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()] || 0) + 1;
    });
    // streak of consecutive weeks with >=1 workout, ending this week or last
    var cursor = new Date();
    cursor.setDate(cursor.getDate() - cursor.getDay());
    var keyOf = function (d) { return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
    if (!byWeek[keyOf(cursor)]) cursor.setDate(cursor.getDate() - 7);
    var streak = 0;
    while (byWeek[keyOf(cursor)] && streak < 104) {
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }
    // avg workouts/week over the last 4 weeks
    var cutoff = U.todayISO(-27);
    var recent = ex.filter(function (r) { return (r.date || "") >= cutoff; }).length;
    var perWk = Math.round((recent / 4) * 10) / 10;
    if (!streak && !recent) return null;
    var bits = [];
    if (streak) bits.push(streak + "-week streak");
    if (recent) bits.push(perWk + " workouts/wk");
    return bits.join(" · ").slice(0, 200);
  }

  /* ---------------- public profile sheet ---------------- */

  function openUser(userId) {
    var S = OF.social;
    cur = { userId: userId, own: userId === A.uid(), posts: [], done: false, loading: true };
    S.sheetOpen(1, '<h2>Profile</h2><p class="muted soc-center">Loading&hellip;</p>', "soc-profile-panel");
    var jobs = [
      A.getProfile(userId),
      A.getFollowCounts(userId).catch(function () { return { followers: 0, following: 0 }; }),
      cur.own ? Promise.resolve(false) : A.isFollowing(userId).catch(function () { return false; }),
      A.getUserPosts(userId, 20).catch(function () { return { posts: [], likedIds: {} }; })
    ];
    Promise.all(jobs).then(function (rs) {
      if (cur === null || cur.userId !== userId) return;
      cur.profile = rs[0];
      cur.counts = rs[1];
      cur.following = rs[2];
      absorbPosts(rs[3]);
      cur.loading = false;
      renderProfileSheet();
    }).catch(function (e) {
      cur = null;
      S.sheetClose(1);
      S.handleErr(e, "Couldn't open that profile.");
    });
  }

  function absorbPosts(res) {
    var p = cur.profile || {};
    var rows = (res.posts || []).map(function (post) {
      post.username = p.username;
      post.display_name = p.display_name;
      post.avatar_url = p.avatar_url;
      post.liked_by_me = !!res.likedIds[post.id];
      return post;
    });
    OF.social.registerPosts(rows);
    var forUser = cur.userId;
    // re-render once the comment previews land (feed pattern) — guarded
    // against the sheet having moved to a different profile meanwhile
    OF.social.preloadComments(rows).then(function () {
      if (cur && cur.userId === forUser && !cur.loading) renderProfileSheet();
    });
    cur.posts = cur.posts.concat(rows);
    if (rows.length < 20) cur.done = true;
  }

  function renderProfileSheet() {
    var S = OF.social;
    var p = cur.profile;
    if (!p) {
      S.sheetOpen(1, '<h2>Profile unavailable</h2>' +
        '<p class="muted">This profile can&rsquo;t be shown &mdash; the account may have been deleted.</p>' +
        '<div class="form-actions"><button type="button" class="btn ghost" data-close-social="1">Close</button></div>');
      return;
    }
    var html = '<div class="soc-prof-head">' +
      S.avatarHtml(p.avatar_url, p.username, "soc-ava-lg") +
      '<div class="soc-prof-names"><h2>' + U.esc(p.display_name || "@" + p.username) + '</h2>' +
      '<p class="muted">@' + U.esc(p.username) + '</p></div></div>' +
      (p.bio ? '<p class="soc-prof-bio">' + U.esc(p.bio) + '</p>' : "") +
      (p.stats_summary ? '<p class="soc-prof-stats">' + OF.icons.get("activity") + ' ' + U.esc(p.stats_summary) + '</p>' : "") +
      '<div class="soc-prof-counts">' +
      '<span><strong>' + Number(cur.counts.followers) + '</strong> followers</span>' +
      '<span><strong>' + Number(cur.counts.following) + '</strong> following</span>' +
      '<span><strong>' + cur.posts.length + (cur.done ? "" : "+") + '</strong> posts</span></div>' +
      '<div class="form-actions soc-prof-actions">';
    if (cur.own) {
      html += '<button type="button" class="btn primary" id="soc-prof-edit">Edit profile</button>';
    } else {
      html += '<button type="button" class="btn' + (cur.following ? "" : " primary") + '" id="soc-prof-follow">' +
        (cur.following ? "Following ✓" : "Follow") + '</button>' +
        '<button type="button" class="btn mini" id="soc-prof-report">Report</button>' +
        '<button type="button" class="btn mini" id="soc-prof-block">Block</button>';
    }
    html += '</div><div class="soc-prof-posts" id="soc-prof-posts">' +
      (cur.posts.length ? cur.posts.map(S.postCardHtml).join("")
        : '<div class="empty-state"><p>No posts yet.</p></div>') +
      '</div>' +
      (cur.done ? "" : '<div class="form-actions"><button type="button" class="btn" id="soc-prof-more">Load more</button></div>');
    var panel = S.sheetOpen(1, html, "soc-profile-panel");
    bindProfileSheet(panel);
  }

  function bindProfileSheet(panel) {
    if (!panel) return;
    var S = OF.social;
    var p = cur.profile;
    var on = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("click", fn);
    };
    on("soc-prof-edit", openEditor);
    on("soc-prof-report", function () { S.openReportSheet("user:" + p.id); });
    on("soc-prof-block", function () { S.openBlockSheet(p.id, p.username); });
    on("soc-prof-follow", function () {
      var was = cur.following;
      cur.following = !was;
      cur.counts.followers = Math.max(0, cur.counts.followers + (was ? -1 : 1));
      renderProfileSheet();
      (was ? A.unfollow(p.id) : A.follow(p.id)).catch(function (e) {
        if (e && e.conflict) return;
        cur.following = was;
        cur.counts.followers = Math.max(0, cur.counts.followers + (was ? 1 : -1));
        renderProfileSheet();
        S.handleErr(e, "Couldn't update the follow.");
      });
    });
    on("soc-prof-more", function () {
      if (cur.loading || cur.done) return;
      cur.loading = true;
      var before = cur.posts.length ? cur.posts[cur.posts.length - 1].created_at : null;
      A.getUserPosts(cur.userId, 20, before).then(function (res) {
        cur.loading = false;
        absorbPosts(res);
        renderProfileSheet();
      }).catch(function (e) {
        cur.loading = false;
        S.handleErr(e, "Couldn't load more posts.");
      });
    });
  }

  /* ---------------- own-profile editor (sheet level 2) ---------------- */

  function openEditor() {
    var S = OF.social;
    var p = (cur && cur.profile) || S.myProfile() || {};
    var statsLine = computeStatsSummary();
    var sharing = !!p.stats_summary;
    var html = '<h2>Edit profile</h2>' +
      '<div class="soc-edit-ava-row" id="soc-edit-ava-row">' +
      S.avatarHtml(p.avatar_url, p.username, "soc-ava-lg") +
      '<label class="btn photo-file-btn">' + OF.icons.get("camera") + '<span>Change photo</span>' +
      '<input type="file" id="soc-edit-ava" accept="image/*" hidden></label></div>' +
      '<p class="form-hint" id="soc-edit-ava-msg"></p>' +
      '<div class="form-row"><label class="grow">Display name' +
      '<input type="text" id="soc-edit-display" maxlength="50" value="' + U.esc(p.display_name || "") + '"></label></div>' +
      '<label class="photo-desc-label">Bio' +
      '<textarea id="soc-edit-bio" maxlength="300" rows="3" placeholder="A line about you (300 characters max)">' +
      U.esc(p.bio || "") + '</textarea></label>' +
      '<div class="soc-stats-share">' +
      '<label class="soc-check"><input type="checkbox" id="soc-edit-stats"' + (sharing ? " checked" : "") +
      (statsLine || sharing ? "" : " disabled") + '> Show a training stats line on my profile</label>' +
      (statsLine
        ? '<p class="muted small">Computed on this device from your workout log: <strong id="soc-stats-preview">' +
          U.esc(statsLine) + '</strong>. Shared only while this is on.</p>'
        : '<p class="muted small">Log a few workouts first and a shareable stats line appears here.</p>') +
      '</div>' +
      '<p class="form-error" id="soc-edit-error" hidden></p>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn primary" id="soc-edit-save">Save</button>' +
      '<button type="button" class="btn ghost" data-close-social="2">Cancel</button></div>';
    S.sheetOpen(2, html, "soc-edit-panel");

    var avaInput = document.getElementById("soc-edit-ava");
    avaInput.addEventListener("change", function () {
      var file = avaInput.files && avaInput.files[0];
      avaInput.value = "";
      if (!file) return;
      var msg = document.getElementById("soc-edit-ava-msg");
      msg.textContent = "Uploading photo…";
      reencodeImage(file, 512, 0.85, function (blob, dataUrl, err) {
        if (err) { msg.textContent = err; return; }
        A.uploadAvatar(blob).then(function (url) {
          msg.textContent = "Photo updated.";
          var row = document.getElementById("soc-edit-ava-row");
          if (row) {
            var old = row.querySelector(".soc-ava");
            var tmp = document.createElement("div");
            tmp.innerHTML = OF.social.avatarHtml(url, p.username, "soc-ava-lg");
            if (old) old.replaceWith(tmp.firstChild);
          }
          if (cur && cur.profile) cur.profile.avatar_url = url;
          OF.social.setMyProfile(A.cachedProfile());
        }).catch(function (e) {
          msg.textContent = "";
          OF.social.handleErr(e, "Couldn't upload that photo.");
        });
      });
    });

    document.getElementById("soc-edit-save").addEventListener("click", function () {
      var btn = this;
      var errEl = document.getElementById("soc-edit-error");
      var display = (document.getElementById("soc-edit-display").value || "").trim().slice(0, 50);
      var bio = (document.getElementById("soc-edit-bio").value || "").trim().slice(0, 300);
      var share = document.getElementById("soc-edit-stats").checked;
      btn.disabled = true;
      btn.textContent = "Saving…";
      A.updateProfile({
        display_name: display || null,
        bio: bio || null,
        stats_summary: share ? (computeStatsSummary() || null) : null
      }).then(function (updated) {
        S.sheetClose(2);
        if (cur && cur.own) {
          cur.profile = updated;
          renderProfileSheet();
        }
        OF.social.setMyProfile(updated);
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = "Save";
        errEl.textContent = (e && e.offline) ? e.message : "Couldn't save — " + (e.message || "try again.");
        errEl.hidden = false;
      });
    });
  }

  return {
    openUser: openUser,
    openEditor: openEditor,
    reencodeImage: reencodeImage,
    computeStatsSummary: computeStatsSummary
  };
})();
