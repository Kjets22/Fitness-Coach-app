/* ============================================================
   social-compose.js — OF.socialCompose: the post composer sheet.

   Kinds: photo | workout | meal. Caption ≤1000, optional image
   (canvas re-encode ≤1600px JPEG q0.85 → post-images/<uid>/…).
   For workout/meal kinds the user can EXPLICITLY attach a
   one-line summary of one of TODAY's local log entries — the
   line is inserted into the caption textarea so exactly what
   will be published is visible before hitting Publish. Nothing
   is ever uploaded automatically.

   Receipt posts (P3-6): the "Receipt" kind lists receipts that
   OF.receipts generated from REAL local data (never typed
   numbers), shows a live preview of the exact card, and
   publishes through the create_receipt_post RPC — the ONLY path
   to the "Verified by data" badge. Plausibility failures are
   shown honestly ("posted without verification: <reason>"); the
   badge is never faked client-side.
   ============================================================ */

window.OF = window.OF || {};

OF.socialCompose = (function () {
  "use strict";

  var U = OF.util;
  var A = OF.socialApi;
  var st = null; // { kind, caption, imgBlob, previewUrl, busy, error }

  /* ---------------- summaries of today's local log ---------------- */

  function fmtKg(kg) {
    try {
      if (OF.units && OF.units.prefs && OF.units.prefs().weightUnit === "lb") {
        return Math.round(kg * 2.20462) + " lb";
      }
    } catch (e) { /* fall through to kg */ }
    return Math.round(kg * 10) / 10 + " kg";
  }

  function workoutSummary(r) {
    var parts = [(r.type || "workout"), (r.durationMin || 0) + " min"];
    (Array.isArray(r.exercises) ? r.exercises.slice(0, 3) : []).forEach(function (ex) {
      if (!ex || !ex.name || !Array.isArray(ex.sets) || !ex.sets.length) return;
      var best = null;
      ex.sets.forEach(function (s) {
        if (s && s.weightKg != null && (best == null || s.weightKg > best.weightKg)) best = s;
      });
      var det = ex.sets.length + "×";
      if (best) det = ex.sets.length + "×" + best.reps + " @ " + fmtKg(best.weightKg);
      else if (ex.sets[0] && ex.sets[0].reps) det = ex.sets.length + "×" + ex.sets[0].reps;
      parts.push(ex.name + " " + det);
    });
    return ("Workout: " + parts.join(" · ")).slice(0, 300);
  }

  function mealSummary(r) {
    var parts = [r.foodName || "meal"];
    if (r.calories != null) parts.push(r.calories + " kcal");
    if (r.protein != null) parts.push(r.protein + "g protein");
    return ("Meal: " + parts.join(" · ")).slice(0, 300);
  }

  function todaysEntries(kind) {
    if (!OF.storage) return [];
    var today = U.todayISO();
    if (kind === "workout") {
      return OF.storage.getAll("exercise").filter(function (r) { return r.date === today; })
        .map(function (r) { return { id: r.id, label: workoutSummary(r) }; });
    }
    if (kind === "meal") {
      return OF.storage.getAll("food").filter(function (r) { return r.date === today; })
        .map(function (r) { return { id: r.id, label: mealSummary(r) }; });
    }
    return [];
  }

  /* ---------------- sheet ---------------- */

  /** open() or open({ kind: "receipt", receiptId: "pr:squat" }) */
  function open(opts) {
    opts = opts || {};
    st = {
      kind: opts.kind || "photo",
      caption: "", imgBlob: null, previewUrl: null, busy: false, error: "",
      receipts: null,           // available-receipt list (lazy)
      receiptId: opts.receiptId || null,
      published: null           // { verified, reason, receipt } after publish
    };
    render();
  }

  /* ---------------- receipt picking ---------------- */

  function receiptList() {
    if (!st.receipts) {
      try { st.receipts = OF.receipts ? OF.receipts.available() : []; }
      catch (e) { st.receipts = []; }
      if (st.receipts.length && (!st.receiptId || !selectedReceipt())) {
        st.receiptId = st.receipts[0].id;
      }
    }
    return st.receipts;
  }

  function selectedReceipt() {
    var list = st.receipts || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === st.receiptId) return list[i];
    return null;
  }

  function receiptSectionHtml() {
    var list = receiptList();
    if (!list.length) {
      return '<div class="empty-state"><p class="muted small">No receipt is generatable from your data yet. ' +
        'Receipts are built from real logged history &mdash; e.g. a recent PR with 6+ sessions over 3+ weeks, ' +
        'or a week of workouts. Keep logging and check back.</p></div>';
    }
    var sel = selectedReceipt();
    var picker = '<div class="rc-pick">' + list.map(function (r) {
      return '<button type="button" class="rc-pick-item' + (r.id === st.receiptId ? " active" : "") +
        '" data-receipt-pick="' + U.esc(r.id) + '"><strong>' + U.esc(r.label) + '</strong>' +
        '<span class="muted small">' + U.esc(r.sub) + '</span></button>';
    }).join("") + '</div>';
    var preview = "";
    if (sel && OF.social.receiptBlockHtml) {
      var check = OF.receipts.validate(sel.receipt);
      preview = '<div class="chart-mini-label">Card preview</div>' +
        OF.social.receiptBlockHtml(sel.receipt, false) +
        '<p class="muted small">' + (check.ok
          ? 'Built from your logged data &mdash; the server re-checks it and awards the ' +
            '&ldquo;Verified by data&rdquo; badge when it passes.'
          : 'Heads-up: this may not verify (' + U.esc(check.reason) + ').') + '</p>';
    }
    return picker + preview;
  }

  /* ---------------- post-publish result ---------------- */

  function publishedHtml() {
    var p = st.published;
    var head = p.verified
      ? '<h2>Posted &mdash; verified <span class="soc-verified">' + OF.icons.get("check") + '</span></h2>' +
        '<p class="muted">The server checked your backing data and awarded the badge.</p>'
      : '<h2>Posted without verification</h2>' +
        '<p class="muted">Your post is live, but it didn&rsquo;t get the badge: <strong>' +
        U.esc(p.reason || "the data couldn't be verified") + '</strong>.</p>';
    return head +
      (OF.social.receiptBlockHtml ? OF.social.receiptBlockHtml(p.receipt, p.verified) : "") +
      '<div class="form-actions">' +
      '<button type="button" class="btn primary" id="soc-comp-shareimg">Share as image</button>' +
      '<button type="button" class="btn ghost" data-close-social="1">Done</button></div>';
  }

  function kindBtn(kind, label) {
    return '<button type="button" class="soc-feed-tab' + (st.kind === kind ? " active" : "") +
      '" data-kind="' + kind + '">' + label + '</button>';
  }

  function render() {
    var S = OF.social;
    if (st.published) {
      var donePanel = S.sheetOpen(1, publishedHtml(), "soc-compose-panel");
      if (donePanel) {
        var shareBtn = document.getElementById("soc-comp-shareimg");
        if (shareBtn) shareBtn.addEventListener("click", function () {
          OF.receipts.openShareSheet(st.published.receipt, st.published.verified, 2);
        });
      }
      return;
    }
    var isReceipt = st.kind === "receipt";
    var attach = isReceipt ? [] : todaysEntries(st.kind);
    var receiptSection = isReceipt ? receiptSectionHtml() : ""; // fills st.receipts
    var hasReceipt = isReceipt && !!selectedReceipt();
    var html = '<h2>Share with the community</h2>' +
      '<div class="soc-feed-bar soc-kind-bar">' +
      kindBtn("photo", "Photo") + kindBtn("workout", "Workout") + kindBtn("meal", "Meal") +
      (OF.receipts ? kindBtn("receipt", "Receipt") : "") +
      '</div>' +
      receiptSection +
      (!isReceipt && st.kind !== "photo" && attach.length
        ? '<div class="soc-attach"><p class="muted small">Attach from today&rsquo;s log (optional &mdash; ' +
          'inserts a summary line you can edit):</p>' +
          attach.slice(0, 6).map(function (a, i) {
            return '<button type="button" class="soc-attach-item" data-attach="' + i + '">' +
              U.esc(a.label) + '</button>';
          }).join("") + '</div>'
        : (!isReceipt && st.kind !== "photo"
          ? '<p class="muted small soc-attach-none">Nothing logged today yet &mdash; you can still write your post.</p>'
          : "")) +
      (isReceipt && !hasReceipt ? "" :
        '<label class="photo-desc-label">Caption' + (isReceipt ? " (optional)" : "") +
        '<textarea id="soc-comp-caption" maxlength="1000" rows="' + (isReceipt ? 2 : 4) + '" ' +
        'placeholder="' + (st.kind === "photo" ? "Say something about this photo…" :
          st.kind === "workout" ? "How did the session go?" :
          isReceipt ? "Add a note to your receipt…" : "What are you eating?") + '">' +
        U.esc(st.caption) + '</textarea></label>' +
        '<p class="muted small soc-comp-count"><span id="soc-comp-n">' + st.caption.length + '</span>/1000</p>') +
      (isReceipt ? "" :
        '<div class="photo-pick-row"><label class="btn photo-file-btn">' + OF.icons.get("camera") +
        '<span>' + (st.previewUrl ? "Change photo" : "Add a photo") + '</span>' +
        '<input type="file" id="soc-comp-file" accept="image/*" hidden></label>' +
        (st.previewUrl ? '<button type="button" class="btn ghost mini" id="soc-comp-imgdel">Remove</button>' : "") +
        '</div>' +
        '<div class="photo-preview">' +
        (st.previewUrl ? '<img src="' + U.esc(st.previewUrl) + '" alt="Photo to post">' : "") + '</div>') +
      '<p class="form-error" id="soc-comp-error"' + (st.error ? "" : " hidden") + '>' + U.esc(st.error) + '</p>' +
      '<div class="form-actions">' +
      (isReceipt && !hasReceipt ? "" :
        '<button type="button" class="btn primary" id="soc-comp-publish"' + (st.busy ? " disabled" : "") + '>' +
        (st.busy ? "Publishing…" : "Publish") + '</button>') +
      '<button type="button" class="btn ghost" data-close-social="1">Cancel</button></div>' +
      '<p class="muted small">Posts are visible to all community members. Publish only what you&rsquo;re happy to share.' +
      (isReceipt ? ' Receipts carry only the summary stats shown above &mdash; never your raw logs.' : '') + '</p>';
    var panel = S.sheetOpen(1, html, "soc-compose-panel");
    bind(panel, attach);
  }

  function saveCaption() {
    var t = document.getElementById("soc-comp-caption");
    if (t) st.caption = t.value.slice(0, 1000);
  }

  function bind(panel, attach) {
    if (!panel) return;
    panel.querySelectorAll("[data-kind]").forEach(function (b) {
      b.addEventListener("click", function () {
        saveCaption();
        st.kind = b.getAttribute("data-kind");
        st.error = "";
        render();
      });
    });
    panel.querySelectorAll("[data-receipt-pick]").forEach(function (b) {
      b.addEventListener("click", function () {
        saveCaption();
        st.receiptId = b.getAttribute("data-receipt-pick");
        st.error = "";
        render();
      });
    });
    panel.querySelectorAll("[data-attach]").forEach(function (b) {
      b.addEventListener("click", function () {
        saveCaption();
        var item = attach[Number(b.getAttribute("data-attach"))];
        if (!item) return;
        st.caption = (item.label + (st.caption ? "\n" + st.caption : "")).slice(0, 1000);
        st.error = "";
        render();
      });
    });
    var ta = document.getElementById("soc-comp-caption");
    var n = document.getElementById("soc-comp-n");
    if (ta && n) ta.addEventListener("input", function () { n.textContent = ta.value.length; });

    var file = document.getElementById("soc-comp-file");
    if (file) file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      saveCaption();
      OF.socialProfile.reencodeImage(f, 1600, 0.85, function (blob, dataUrl, err) {
        if (err) { st.error = err; st.imgBlob = null; st.previewUrl = null; }
        else { st.error = ""; st.imgBlob = blob; st.previewUrl = dataUrl; }
        render();
      });
    });
    var del = document.getElementById("soc-comp-imgdel");
    if (del) del.addEventListener("click", function () {
      saveCaption();
      st.imgBlob = null;
      st.previewUrl = null;
      render();
    });
    var pub = document.getElementById("soc-comp-publish");
    if (pub) pub.addEventListener("click", publish);
  }

  function publish() {
    if (st.busy) return;
    saveCaption();
    var caption = st.caption.trim();

    if (st.kind === "receipt") {
      var sel = selectedReceipt();
      if (!sel) { st.error = "Pick a receipt first."; render(); return; }
      st.busy = true;
      st.error = "";
      render();
      A.createReceiptPost(caption || null, sel.receipt).then(function (res) {
        st.busy = false;
        res = res || {};
        // Honest result: the badge comes ONLY from the server's verdict.
        st.published = {
          verified: res.verified === true,
          reason: res.reason || null,
          receipt: sel.receipt
        };
        if (sel.receipt.type === "weekly" && OF.receipts) OF.receipts.markWeeklyPosted();
        OF.social.onPosted();
        render();
      }).catch(function (e) {
        st.busy = false;
        st.error = (e && e.offline) ? e.message : "Couldn't publish — " + ((e && e.message) || "try again.");
        render();
        if (e && e.authExpired) OF.social.handleErr(e);
      });
      return;
    }

    if (!caption && !st.imgBlob) {
      st.error = "Add a caption or a photo first.";
      render();
      return;
    }
    st.busy = true;
    st.error = "";
    render();
    var upload = st.imgBlob ? A.uploadPostImage(st.imgBlob) : Promise.resolve(null);
    upload.then(function (key) {
      return A.createPost(st.kind, caption || null, key);
    }).then(function () {
      st.busy = false;
      OF.social.sheetClose(1);
      U.toast("Posted!", "warn");
      OF.social.onPosted();
    }).catch(function (e) {
      st.busy = false;
      st.error = (e && e.offline) ? e.message : "Couldn't publish — " + ((e && e.message) || "try again.");
      render();
      if (e && e.authExpired) OF.social.handleErr(e);
    });
  }

  return { open: open };
})();
