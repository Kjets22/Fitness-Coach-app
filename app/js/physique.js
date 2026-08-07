/* ============================================================
   physique.js — "Analyze physique from photo" on the Body tab.

   Sends 1-4 body photos (each re-encoded client-side to a
   <=1600px JPEG; e.g. upper body front, back, legs) to the
   serve.py bridge (POST /api/physique), which has the AI view the
   image(s) and produce ONE combined body-neutral visual ESTIMATE
   of body composition + muscle development. The user reviews it
   and can Save the ANALYSIS (a `physique` record — the image
   bytes are NEVER stored) or Discard.

   Degrades exactly like coach.js / food-photo.js: without the
   server the button renders disabled with a hint. Phone mode
   reuses the SAME pairing key coach.js stores (optimalfit.pairKey,
   X-OF-Key). All rendered text goes through U.esc().

   PRIVACY — keep every user-facing claim here ACCURATE: photos
   ARE sent over the network to the owner's coach server and are
   processed by Anthropic's Claude to produce the analysis. They
   are used transiently for that one analysis and are not stored
   by the app or the server. Never write copy claiming photos
   "stay on this device" or "are never sent anywhere".
   ============================================================ */

window.OF = window.OF || {};

OF.physique = (function () {
  "use strict";

  var U = OF.util, S = OF.storage;
  var els = {};
  var server = null;          // null (unknown) | "ok" | "no-server"
  var state = "pick";         // pick | loading | result | nonbody | error | saved
  var busy = false;
  var photos = [];            // [{b64, url, label}] — up to MAX_PHOTOS
  var description = "";        // survives re-renders
  var analysis = null;         // last parsed analysis from the server
  var errorMsg = "";
  var reqSeq = 0;             // stale-result guard (see doEstimate/doAnalyze)

  var MAX_SIDE = 1600;
  var JPEG_QUALITY = 0.85;
  var REQUEST_TIMEOUT_MS = 130000; // server kills the CLI at 120 s

  /* Multiple photos -> one combined analysis (upper body from the front,
     back, legs …). Labels tell the AI which angle each photo shows; tapping
     a label cycles through the options. */
  var MAX_PHOTOS = 4;
  var LABEL_OPTIONS = ["Front", "Back", "Legs", "Side", "Upper body", "Lower body"];

  var REGION_ORDER = ["shoulders", "chest", "arms", "back", "core", "legs"];
  var REGION_LABEL = {
    shoulders: "Shoulders", chest: "Chest", arms: "Arms",
    back: "Back", core: "Core", legs: "Legs"
  };
  var MUSC_LABEL = {
    "low": "Low", "below-average": "Below average", "average": "Average",
    "above-average": "Above average", "high": "High"
  };

  /* Same key + header contract as coach.js (one pairing for all /api). */
  var PAIR_KEY_STORE = "optimalfit.pairKey";
  function pairKey() {
    try { return localStorage.getItem(PAIR_KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function clearPairKey() {
    try { localStorage.removeItem(PAIR_KEY_STORE); } catch (e) { /* ignore */ }
  }
  function apiHeaders(extra) {
    var h = extra || {};
    var k = (OF.coachApi && OF.coachApi.key()) || pairKey();
    if (k) h["X-OF-Key"] = k;
    return h;
  }

  /* Platform-aware launcher wording (same contract as coach.js): the native
     mobile app can't start the server at all, a Mac desktop uses the .command
     launcher, Windows uses the .bat. */
  function isNativeApp() {
    var C = window.Capacitor;
    if (!C) return false;
    return C.isNativePlatform ? C.isNativePlatform() : (C.platform && C.platform !== "web");
  }
  function launcherName() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent || "") ?
      "Start OptimalFit.command" : "Start OptimalFit.bat";
  }

  /* ---------------- server availability ---------------- */

  function apiUrl(path) {
    return OF.coachApi ? OF.coachApi.url(path) : path;
  }

  var probeSeq = 0;   // a stale slow probe must never overwrite a fresh result

  function checkServer() {
    if (location.protocol !== "http:" && location.protocol !== "https:" &&
        !(OF.coachApi && OF.coachApi.remote())) {
      server = "no-server";
      renderButton();
      return;
    }
    var seq = ++probeSeq;
    var pc = ("AbortController" in window) ? new AbortController() : null;
    var pt = pc ? setTimeout(function () { pc.abort(); }, 8000) : null;   // a hung probe dies in 8 s
    fetch(apiUrl("/api/health"), { cache: "no-store", headers: apiHeaders(), signal: pc ? pc.signal : undefined })
      .then(function (res) { return res.json(); })
      .then(function (j) {
        if (seq !== probeSeq) return;
        server = (j && j.ok && j.claude && j.keyOk !== false) ? "ok" : "no-server";
        renderButton();
      })
      .catch(function () {
        if (seq !== probeSeq) return;
        server = "no-server";
        renderButton();
      })
      .then(function () { if (pt) clearTimeout(pt); });
  }

  /* ---------------- button (Body tab, above the form) ---------------- */

  function renderButton() {
    if (!els.area) return;
    // Physique analysis is a Premium AI feature.
    if (OF.entitlements && !OF.entitlements.isPremium()) {
      els.area.innerHTML = OF.entitlements.paywallHtml({
        compact: true,
        title: (OF.icons ? OF.icons.get("bodyscan") + " " : "") + "Physique analysis",
        blurb: "AI estimates body composition and muscle development from your photos (analyzed transiently by the coach service and Anthropic's Claude, never stored)."
      });
      OF.entitlements.bindPaywall(els.area, renderButton);
      return;
    }
    var disabled = server !== "ok";
    els.area.innerHTML =
      '<button type="button" class="btn photo-btn" id="physique-open"' +
      (disabled ? ' disabled' : '') + '>' + OF.icons.get("bodyscan") +
      '<span>Analyze physique from photo</span></button>' +
      (disabled
        ? '<span class="muted small photo-hint">Needs the OptimalFit server &mdash; see Coach tab</span>'
        : '<span class="muted small photo-hint">Estimate body composition &amp; muscle development to guide your targets</span>');
  }

  /* ---------------- image re-encode (identical approach to food-photo) ---- */

  function reencode(file, cb) {
    var url;
    try { url = URL.createObjectURL(file); }
    catch (e) { cb(null, null, "That file could not be opened."); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error("empty image");
        var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var chh = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = chh;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, cw, chh);
        var dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        URL.revokeObjectURL(url);
        var prefix = "data:image/jpeg;base64,";
        if (dataUrl.indexOf(prefix) !== 0) throw new Error("encode failed");
        cb(dataUrl.slice(prefix.length), dataUrl, null);
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

  /* ---------------- modal rendering ---------------- */

  function confBadge(level) {
    var l = (level === "high" || level === "medium") ? level : "low";
    return '<span class="conf conf-' + l + '">' + U.esc(l) + ' confidence</span>';
  }

  function panelHtml(inner) {
    return '<div class="sheet-backdrop" data-close-phys></div>' +
      '<div class="sheet-panel photo-panel">' +
      '<div class="sheet-grab" aria-hidden="true"></div>' + inner + '</div>';
  }

  var PRIVACY_LINE =
    '<p class="muted small phys-privacy">' + OF.icons.get("check") +
    ' Your photos are sent securely to the OptimalFit coach service and analyzed by ' +
    'Anthropic&rsquo;s Claude AI. They are used only for this one analysis and deleted right ' +
    'after &mdash; neither the app nor the coach service keeps them. Only the written ' +
    'analysis can be saved.</p>';

  function thumbsHtml(withControls) {
    if (!photos.length) return "";
    return '<div class="phys-thumbs">' + photos.map(function (p, i) {
      return '<div class="phys-thumb">' +
        '<img src="' + U.esc(p.url) + '" alt="' + U.esc(p.label) + ' physique photo">' +
        (withControls
          ? '<button type="button" class="phys-thumb-label" data-phys-label="' + i + '" ' +
              'title="Tap to change which angle this photo shows">' + U.esc(p.label) + '</button>' +
            '<button type="button" class="phys-thumb-x" data-phys-remove="' + i + '" ' +
              'aria-label="Remove photo">&times;</button>'
          : '<span class="phys-thumb-label">' + U.esc(p.label) + '</span>') +
        '</div>';
    }).join("") + '</div>';
  }

  function pickHtml() {
    return '<h2>Analyze physique from photos</h2>' +
      '<div class="photo-pick-row">' +
        '<label class="btn photo-file-btn"' + (photos.length >= MAX_PHOTOS ? ' hidden' : '') + '>' +
          OF.icons.get("bodyscan") +
          '<span>' + (photos.length ? 'Add more photos' : 'Take / choose photos') + '</span>' +
          '<input type="file" id="phys-file" accept="image/*" multiple hidden>' +
        '</label>' +
      '</div>' +
      '<p class="muted small">Add up to ' + MAX_PHOTOS + ' photos in one go &mdash; e.g. upper body ' +
        'from the front, your back, and your legs &mdash; for one combined analysis. ' +
        'Tap a photo&rsquo;s label if it shows a different angle.</p>' +
      thumbsHtml(true) +
      '<label class="photo-desc-label">Details (optional)' +
        '<textarea id="phys-desc" maxlength="500" rows="2" ' +
        'placeholder="Optional: height, weight, training experience, your goal — improves the estimate">' +
        U.esc(description) + '</textarea>' +
      '</label>' +
      PRIVACY_LINE +
      '<p class="form-error" id="phys-error"' + (errorMsg ? '' : ' hidden') + '>' +
        U.esc(errorMsg) + '</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="phys-analyze"' +
          (photos.length ? '' : ' disabled') + '>Analyze' +
          (photos.length > 1 ? ' ' + photos.length + ' photos' : '') + '</button>' +
        '<button type="button" class="btn ghost" data-close-phys>Cancel</button>' +
      '</div>';
  }

  function loadingHtml() {
    return '<h2>Analyze physique from photos</h2>' +
      thumbsHtml(false) +
      '<div class="msg-row photo-thinking">' +
        '<span class="coach-avatar" aria-hidden="true">' + OF.icons.get("bodyscan") + '</span>' +
        '<div class="bubble bubble-coach bubble-thinking">' +
        '<span id="phys-think-label">Assessing your physique&hellip;</span> ' +
        '<span class="dots"><span></span><span></span><span></span></span>' +
        '<span id="phys-think-elapsed" class="think-elapsed"></span></div>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn ghost" data-close-phys>Cancel</button>' +
      '</div>';
  }

  function chips(list, cls) {
    if (!list || !list.length) return "";
    return list.map(function (s) {
      return '<span class="phys-chip ' + cls + '">' + U.esc(s) + '</span>';
    }).join("");
  }

  function regionsHtml(regions) {
    regions = regions || {};
    var rows = [];
    REGION_ORDER.forEach(function (k) {
      var v = regions[k];
      if (!v) return;
      rows.push('<div class="phys-region"><span class="phys-region-name">' +
        U.esc(REGION_LABEL[k]) + '</span><span class="phys-region-note">' +
        U.esc(v) + '</span></div>');
    });
    return rows.length ? '<div class="phys-regions">' + rows.join("") + '</div>' : "";
  }

  function resultHtml() {
    var a = analysis;
    var low = a.bodyFatRangeLow, high = a.bodyFatRangeHigh, mid = a.bodyFatMidpoint;
    var bfLine = (low != null && high != null)
      ? U.esc(low + "–" + high + "% body fat") +
        (mid != null ? ' <span class="muted small">(midpoint ~' + U.esc(String(mid)) + '%)</span>' : '')
      : "";
    var musc = MUSC_LABEL[a.muscularity] || "Average";
    return '<h2>Physique analysis</h2>' +
      '<div class="photo-result-head">' +
        '<strong class="phys-musc">Muscular development: ' + U.esc(musc) + '</strong>' +
        confBadge(a.confidence) +
      '</div>' +
      (bfLine ? '<p class="phys-bf">' + bfLine + '</p>' : '') +
      regionsHtml(a.regions) +
      (a.strengths && a.strengths.length
        ? '<div class="phys-chip-group"><span class="phys-chip-label">Strengths</span>' +
          chips(a.strengths, "good") + '</div>' : '') +
      (a.focusAreas && a.focusAreas.length
        ? '<div class="phys-chip-group"><span class="phys-chip-label">Focus areas</span>' +
          chips(a.focusAreas, "focus") + '</div>' : '') +
      (a.overallAssessment
        ? '<p class="phys-assessment">' + U.esc(a.overallAssessment) + '</p>' : '') +
      (a.notes ? '<p class="muted small phys-notes">' + U.esc(a.notes) + '</p>' : '') +
      '<p class="muted small phys-disclaimer">This is a visual estimate, not a medical ' +
        'body-composition measurement. Lighting, pose and clothing all affect it.</p>' +
      '<p class="form-error" id="phys-error" hidden></p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="phys-save">Save this analysis</button>' +
        '<button type="button" class="btn ghost" id="phys-again">Analyze another</button>' +
        '<button type="button" class="btn ghost" data-close-phys>Discard</button>' +
      '</div>';
  }

  function nonBodyHtml() {
    var a = analysis;
    return '<h2>That doesn’t look like a physique photo</h2>' +
      '<p class="muted">' + (U.esc(a && a.notes) ||
        "The AI could not assess a body in these photos. Use well-lit, " +
        "form-fitting or minimal-clothing photos (front, back, side or legs).") + '</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="phys-again">Try other photos</button>' +
        '<button type="button" class="btn ghost" data-close-phys>Close</button>' +
      '</div>';
  }

  function savedHtml() {
    return '<h2>Analysis saved</h2>' +
      '<p class="muted">Your physique analysis was saved. See it (and your progress ' +
      'over time) on the <strong>Insights</strong> tab. The photo itself was not stored.</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" data-close-phys>Done</button>' +
      '</div>';
  }

  function errorHtml() {
    return '<h2>Analysis failed</h2>' +
      '<p class="form-error">' + U.esc(errorMsg || "Something went wrong.") + '</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="phys-again">Try again</button>' +
        '<button type="button" class="btn ghost" data-close-phys>Close</button>' +
      '</div>';
  }

  function renderModal() {
    if (!els.modal) return;
    var inner =
      state === "loading" ? loadingHtml() :
      state === "result" ? resultHtml() :
      state === "nonbody" ? nonBodyHtml() :
      state === "saved" ? savedHtml() :
      state === "error" ? errorHtml() : pickHtml();
    els.modal.innerHTML = panelHtml(inner);
  }

  function openModal() {
    state = "pick";
    photos = [];
    description = "";
    analysis = null;
    errorMsg = "";
    renderModal();
    els.modal.classList.remove("hidden");
  }

  function closeModal() {
    // abandon anything in flight: bump the sequence so a late result is
    // dropped, and kill the 1 Hz label ticker (it used to run until the job
    // settled, and in the resend-pending state that could be forever)
    reqSeq++;
    stopThinkTicker();
    busy = false;
    els.modal.classList.add("hidden");
    els.modal.innerHTML = "";
  }

  function isOpen() {
    return els.modal && !els.modal.classList.contains("hidden");
  }

  /* ---------------- analyze request ---------------- */

  function saveDesc() {
    var t = document.getElementById("phys-desc");
    if (t) description = t.value.slice(0, 500);
  }

  /* The user's own height/weight/age/sex (already tracked — height is set on
     the goal, weight from body logs) materially sharpen a visual body-fat /
     composition estimate. All optional; sent only when present. */
  function num(v) { return (typeof v === "number" && isFinite(v)) ? v : (v != null && v !== "" && isFinite(Number(v)) ? Number(v) : null); }
  function bodyStats() {
    var s = {};
    try {
      var g = (OF.goals && OF.goals.activeGoal) ? OF.goals.activeGoal() : null;
      if (g) {
        if (num(g.heightCm) != null) s.heightCm = Math.round(num(g.heightCm));
        if (num(g.age) != null) s.age = Math.round(num(g.age));
        // the goal stores sex as "m"/"f"; the physique endpoint expects "male"/"female"
        if (g.sex === "m") s.sex = "male";
        else if (g.sex === "f") s.sex = "female";
      }
      var body = (S.getAll("body") || []).slice().sort(U.byNewest);
      for (var i = 0; i < body.length; i++) {
        if (num(body[i].weightKg) != null) {
          s.weightKg = Math.round(num(body[i].weightKg) * 10) / 10;
          break;
        }
      }
    } catch (e) { /* stats are optional — never block the analysis */ }
    return s;
  }

  function doAnalyze() {
    if (busy || !photos.length) return;
    saveDesc();
    busy = true;
    state = "loading";
    renderModal();
    startThinkTicker();
    // Closing the modal used to cancel nothing (the AbortController here was
    // never actually assigned), so an old job could resolve over a NEWER
    // photo and attribute the wrong macros to it. Every request now carries
    // a sequence number and a stale one is dropped on arrival.
    var seq = ++reqSeq;

    // Background-safe: server job + poll via OF.aiJob — switching apps
    // mid-analysis no longer errors; the result is waiting on return.
    OF.aiJob.request({
      path: "/api/physique",
      apiUrl: apiUrl,
      apiHeaders: apiHeaders,
      payload: {
        // legacy single-image fields keep an updated app working against an
        // older server; a current server prefers the richer `images` list
        imageBase64: photos[0].b64,
        mime: "image/jpeg",
        images: photos.map(function (p) {
          return { imageBase64: p.b64, mime: "image/jpeg", label: p.label };
        }),
        description: description,
        stats: bodyStats()   // height/weight/age/sex sharpen the composition estimate
      }
    })
      .then(function (r) {
        if (seq !== reqSeq) return;      // a newer request supersedes this one
        var httpStatus = r.status, j = r.body;
        if (!isOpen()) return;
        if (httpStatus === 401) {
          state = "error";
          if (OF.coachApi && OF.coachApi.remote() && OF.coachApi.key()) {
            // remote/public mode uses the key BAKED into this build — there is
            // no pairing code to enter, so don't send the user hunting for one
            errorMsg = "The server didn't accept this app's access key — the key on " +
              "the computer was probably changed after this app was built. Restart the " +
              "server with the matching key (or rebuild the app), then retry.";
          } else {
            clearPairKey();
            errorMsg = "The server asked to pair again. Open the Coach tab and " +
              "enter the current 6-digit code from the server window, then retry.";
          }
        } else if (httpStatus === 429) {
          state = "error";
          errorMsg = (j && j.error) ||
            "The AI is busy with another request — try again in a minute.";
        } else if (j && j.ok && j.analysis && typeof j.analysis === "object") {
          analysis = j.analysis;
          state = analysis.analyzed ? "result" : "nonbody";
        } else {
          state = "error";
          errorMsg = (j && j.error) || "The server returned an unexpected response.";
        }
        renderModal();
      })
      .catch(function (e) {
        if (seq !== reqSeq) return;
        if (!isOpen()) return;
        state = "error";
        errorMsg = (e && e.name === "AbortError")
          ? "The analysis took too long and was cancelled. Your photo is kept — tap Try again."
          : ((OF.coachApi && OF.coachApi.remote())
              ? "Could not reach OptimalFit on your computer — it may be asleep or offline. Wake it up, then tap Try again. Your photo is kept."
              : (isNativeApp()
                  ? "Could not reach OptimalFit on your computer. Make sure it’s running there and this phone is on the same Wi-Fi."
                  : "Could not reach the local server. Is “" + launcherName() + "” still running?"));
        renderModal();
      })
      .then(function () { // finally
        if (seq !== reqSeq) return;      // don't unlock/stop a newer request
        stopThinkTicker();
        busy = false;
      });
  }

  /* Same anti-"stuck" ticker as the meal estimate: seconds + a rotating
     phase label, so a 60 s multi-photo analysis never looks frozen. */
  var thinkTimer = null, thinkStart = 0;
  function startThinkTicker() {
    stopThinkTicker();
    thinkStart = Date.now();
    thinkTimer = setInterval(function () {
      var secs = Math.round((Date.now() - thinkStart) / 1000);
      var el = document.getElementById("phys-think-elapsed");
      var lab = document.getElementById("phys-think-label");
      if (!el && !lab) return;
      if (el) el.textContent = secs >= 3 ? " " + secs + "s" : "";
      if (lab) {
        lab.textContent = secs < 8 ? "Assessing your physique\u2026"
          : secs < 25 ? "Reading structure and development\u2026"
          : secs < 60 ? "Estimating composition\u2026"
          : "Still working \u2014 you can leave the app, the answer will be here when you\u2019re back\u2026";
      }
    }, 1000);
  }
  function stopThinkTicker() {
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
  }

  /* ---------------- save the analysis (NO image bytes) ---------------- */

  function saveAnalysis() {
    if (!analysis || !analysis.analyzed) return;
    var a = analysis;
    var rec = {
      date: U.todayISO(),
      bodyFatMidpoint: a.bodyFatMidpoint,
      bodyFatRangeLow: a.bodyFatRangeLow,
      bodyFatRangeHigh: a.bodyFatRangeHigh,
      muscularity: a.muscularity,
      regions: a.regions || {},
      strengths: a.strengths || [],
      focusAreas: a.focusAreas || [],
      overallAssessment: a.overallAssessment || "",
      confidence: a.confidence,
      notes: a.notes || ""
    };
    var saved = S.add("physique", rec);
    if (!saved) {
      errorMsg = "Could not save — browser storage is full or blocked.";
      var err = document.getElementById("phys-error");
      if (err) { err.textContent = errorMsg; err.hidden = false; }
      return;
    }
    // Refresh anything that reads physique data (Insights card, coach context
    // is rebuilt on demand). The image is intentionally never persisted.
    try { if (OF.insights) OF.insights.refresh(); } catch (e) { /* ignore */ }
    state = "saved";
    renderModal();
  }

  /* ---------------- wiring ---------------- */

  function nextLabel() {
    for (var i = 0; i < LABEL_OPTIONS.length; i++) {
      var taken = photos.some(function (p) { return p.label === LABEL_OPTIONS[i]; });
      if (!taken) return LABEL_OPTIONS[i];
    }
    return LABEL_OPTIONS[0];
  }

  function onFilePicked(input) {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    errorMsg = "";
    saveDesc();
    var room = MAX_PHOTOS - photos.length;
    if (files.length > room) {
      files = files.slice(0, room);
      errorMsg = "Up to " + MAX_PHOTOS + " photos per analysis — extra photos were skipped.";
    }
    var pending = files.length;
    files.forEach(function (file) {
      reencode(file, function (b64, dataUrl, err) {
        if (err) errorMsg = err;
        else if (photos.length < MAX_PHOTOS) {
          photos.push({ b64: b64, url: dataUrl, label: nextLabel() });
        }
        if (--pending === 0 && isOpen() && state === "pick") renderModal();
      });
    });
  }

  function init() {
    els.area = document.getElementById("body-photo-area");
    els.modal = document.getElementById("physique-modal");
    if (!els.area || !els.modal) return;
    renderButton();

    els.area.addEventListener("click", function (e) {
      if (e.target.closest("#physique-open")) {
        if (OF.aiConsent && !OF.aiConsent.granted()) { OF.aiConsent.ensure(openModal); return; }
        openModal();
      }
    });

    els.modal.addEventListener("click", function (e) {
      if (e.target.closest("[data-close-phys]")) { closeModal(); return; }
      if (e.target.closest("#phys-analyze")) { doAnalyze(); return; }
      var lbl = e.target.closest("[data-phys-label]");
      if (lbl) {   // tap the label chip -> cycle Front -> Back -> Legs -> …
        var li = Number(lbl.getAttribute("data-phys-label"));
        if (photos[li]) {
          var cur = LABEL_OPTIONS.indexOf(photos[li].label);
          photos[li].label = LABEL_OPTIONS[(cur + 1) % LABEL_OPTIONS.length];
          saveDesc();
          renderModal();
        }
        return;
      }
      var rm = e.target.closest("[data-phys-remove]");
      if (rm) {
        photos.splice(Number(rm.getAttribute("data-phys-remove")), 1);
        saveDesc();
        renderModal();
        return;
      }
      if (e.target.closest("#phys-save")) { saveAnalysis(); return; }
      if (e.target.closest("#phys-again")) {
        state = "pick";
        errorMsg = "";
        renderModal();
      }
    });
    els.modal.addEventListener("change", function (e) {
      if (e.target && e.target.id === "phys-file") onFilePicked(e.target);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) closeModal();
    });
  }

  /** Called by app.js every time the Body tab is opened. */
  function onEnter() {
    if (server !== "ok") checkServer();
    else renderButton(); // re-evaluate the premium gate (sign-in may have happened)
  }

  return { init: init, onEnter: onEnter };
})();
