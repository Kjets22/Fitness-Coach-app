/* ============================================================
   food-photo.js — "Estimate from photo" on the Food tab.
   Sends a photo (re-encoded client-side to a <=1600px JPEG) to
   the local serve.py bridge (POST /api/estimate), which runs the
   user's Claude Code subscription headlessly with ONLY the Read
   tool so it can view the image. The result prefills the normal
   food form; the user reviews/edits and saves as usual.

   Degrades exactly like coach.js: without the server the button
   renders disabled with a hint. Phone mode reuses the SAME
   pairing key coach.js stores (optimalfit.pairKey, X-OF-Key).
   All rendered text goes through U.esc().
   ============================================================ */

window.OF = window.OF || {};

OF.foodPhoto = (function () {
  "use strict";

  var U = OF.util;
  var els = {};
  var server = null;          // null (unknown) | "ok" | "no-server"
  var state = "pick";         // pick | loading | result | nonfood | error
  var busy = false;
  var imgB64 = null;          // raw base64 of the re-encoded JPEG
  var previewUrl = null;      // data: URL for the thumbnail
  var description = "";       // survives re-renders
  var estimate = null;        // last parsed estimate from the server
  var errorMsg = "";
  var ctrl = null;            // in-flight AbortController

  var MAX_SIDE = 1600;        // longest side after re-encode
  var JPEG_QUALITY = 0.85;
  var REQUEST_TIMEOUT_MS = 130000; // server kills the CLI at 120 s

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

  /* Platform-aware launcher wording, kept in sync with coach.js (separate IIFE,
     no shared scope): the native mobile app can't start the companion server, a
     Mac desktop uses the .command launcher, Windows uses the .bat. */
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

  function checkServer() {
    // file:// -> there is no server origin to ask.
    if (location.protocol !== "http:" && location.protocol !== "https:" &&
        !(OF.coachApi && OF.coachApi.remote())) {
      server = "no-server";
      renderButton();
      return;
    }
    fetch(apiUrl("/api/health"), { cache: "no-store", headers: apiHeaders() })
      .then(function (res) { return res.json(); })
      .then(function (j) {
        // Respect keyOk like coach.js: an unpaired phone (keyOk:false) must not
        // get an enabled button — the hint points them to the Coach tab to pair.
        server = (j && j.ok && j.claude && j.keyOk !== false) ? "ok" : "no-server";
        renderButton();
      })
      .catch(function () {
        server = "no-server";
        renderButton();
      });
  }

  /* ---------------- button (Food tab, above the form) ---------------- */

  function renderButton() {
    if (!els.area) return;
    // Photo → macros is a Premium AI feature.
    if (OF.entitlements && !OF.entitlements.isPremium()) {
      els.area.innerHTML = OF.entitlements.paywallHtml({
        title: "Photo macros are Premium",
        blurb: "Snap a meal and AI estimates the calories and macros for you."
      });
      OF.entitlements.bindPaywall(els.area, renderButton);
      return;
    }
    var disabled = server !== "ok";
    els.area.innerHTML =
      '<button type="button" class="btn photo-btn" id="photo-open"' +
      (disabled ? ' disabled' : '') + '>' + OF.icons.get("camera") +
      '<span>Estimate from photo</span></button>' +
      (disabled
        ? '<span class="muted small photo-hint">Needs the OptimalFit server &mdash; see Coach tab</span>'
        : '<span class="muted small photo-hint">Snap your meal, get the macros prefilled</span>');
  }

  /* ---------------- image re-encode ----------------
     Canvas re-encode to JPEG (max 1600px longest side, q 0.85):
     shrinks multi-MB phone photos AND converts formats the server
     doesn't accept but the browser can decode (e.g. HEIC on iOS
     Safari). If the browser cannot decode the file at all we show
     a friendly "unsupported image" error. */

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
    return '<div class="sheet-backdrop" data-close-photo></div>' +
      '<div class="sheet-panel photo-panel">' +
      '<div class="sheet-grab" aria-hidden="true"></div>' + inner + '</div>';
  }

  function pickHtml() {
    return '<h2>Estimate from photo</h2>' +
      '<div class="photo-pick-row">' +
        '<label class="btn photo-file-btn">' + OF.icons.get("camera") +
          '<span>' + (previewUrl ? 'Change photo' : 'Take / choose photo') + '</span>' +
          '<input type="file" id="photo-file" accept="image/*" hidden>' +
        '</label>' +
      '</div>' +
      '<div class="photo-preview" id="photo-preview">' +
        (previewUrl ? '<img src="' + U.esc(previewUrl) + '" alt="Selected meal photo">' : '') +
      '</div>' +
      '<label class="photo-desc-label">Details (optional)' +
        '<textarea id="photo-desc" maxlength="500" rows="2" ' +
        'placeholder="Add details to improve the estimate: portion size, cooking oil, sauces…">' +
        U.esc(description) + '</textarea>' +
      '</label>' +
      '<p class="form-error" id="photo-error"' + (errorMsg ? '' : ' hidden') + '>' +
        U.esc(errorMsg) + '</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="photo-estimate"' +
          (imgB64 ? '' : ' disabled') + '>Estimate</button>' +
        '<button type="button" class="btn ghost" data-close-photo>Cancel</button>' +
      '</div>';
  }

  function loadingHtml() {
    return '<h2>Estimate from photo</h2>' +
      '<div class="photo-preview">' +
        (previewUrl ? '<img src="' + U.esc(previewUrl) + '" alt="Selected meal photo">' : '') +
      '</div>' +
      '<div class="msg-row photo-thinking">' +
        '<span class="coach-avatar" aria-hidden="true">' + OF.icons.get("camera") + '</span>' +
        '<div class="bubble bubble-coach bubble-thinking">Analyzing your meal&hellip; 10&ndash;60 s ' +
        '<span class="dots"><span></span><span></span><span></span></span></div>' +
      '</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn ghost" data-close-photo>Cancel</button>' +
      '</div>';
  }

  function numField(id, label, value, max, step) {
    return '<label>' + label +
      '<input type="number" id="' + id + '" min="0" max="' + max +
      '" step="' + step + '" value="' + U.esc(value == null ? "" : String(value)) + '">' +
      '</label>';
  }

  function resultHtml() {
    var e = estimate;
    return '<h2>Estimate</h2>' +
      '<div class="photo-result-head">' +
        '<strong class="photo-food-name">' + (U.esc(e.foodName) || "Unnamed food") + '</strong>' +
        confBadge(e.confidence) +
      '</div>' +
      (e.portionEstimate ? '<p class="muted small photo-portion">Portion: ' +
        U.esc(e.portionEstimate) + '</p>' : '') +
      '<div class="photo-macros">' +
        numField("photo-cal", "Calories (kcal)", e.calories, 10000, 1) +
        numField("photo-prot", "Protein (g)", e.protein_g, 1000, 0.1) +
        numField("photo-carb", "Carbs (g)", e.carbs_g, 1000, 0.1) +
        numField("photo-fat", "Fat (g)", e.fat_g, 1000, 0.1) +
      '</div>' +
      (e.notes ? '<p class="muted small photo-notes">' + U.esc(e.notes) + '</p>' : '') +
      '<p class="muted small">This is an AI estimate &mdash; adjust anything before saving.</p>' +
      '<p class="form-error" id="photo-error" hidden></p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="photo-use">Use these values</button>' +
        '<button type="button" class="btn ghost" id="photo-again">Try again</button>' +
      '</div>';
  }

  function nonFoodHtml() {
    var e = estimate;
    return '<h2>That doesn’t look like food</h2>' +
      '<p class="muted">' + (U.esc(e && e.notes) ||
        "The AI could not identify any food in this photo.") + '</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="photo-again">Try another photo</button>' +
        '<button type="button" class="btn ghost" data-close-photo>Close</button>' +
      '</div>';
  }

  function errorHtml() {
    return '<h2>Estimate failed</h2>' +
      '<p class="form-error">' + U.esc(errorMsg || "Something went wrong.") + '</p>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn primary" id="photo-again">Try again</button>' +
        '<button type="button" class="btn ghost" data-close-photo>Close</button>' +
      '</div>';
  }

  function renderModal() {
    if (!els.modal) return;
    var inner =
      state === "loading" ? loadingHtml() :
      state === "result" ? resultHtml() :
      state === "nonfood" ? nonFoodHtml() :
      state === "error" ? errorHtml() : pickHtml();
    els.modal.innerHTML = panelHtml(inner);
  }

  function openModal() {
    state = "pick";
    imgB64 = null;
    previewUrl = null;
    description = "";
    estimate = null;
    errorMsg = "";
    renderModal();
    els.modal.classList.remove("hidden");
  }

  function closeModal() {
    if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } ctrl = null; }
    busy = false;
    els.modal.classList.add("hidden");
    els.modal.innerHTML = "";
  }

  function isOpen() {
    return els.modal && !els.modal.classList.contains("hidden");
  }

  /* ---------------- estimate request ---------------- */

  function saveDesc() {
    var t = document.getElementById("photo-desc");
    if (t) description = t.value.slice(0, 500);
  }

  function doEstimate() {
    if (busy || !imgB64) return;
    saveDesc();
    busy = true;
    state = "loading";
    renderModal();

    ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS) : null;
    var httpStatus = 0;

    fetch(apiUrl("/api/estimate"), {
      method: "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        imageBase64: imgB64,
        mime: "image/jpeg",
        description: description
      }),
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(function (res) { httpStatus = res.status; return res.json(); })
      .then(function (j) {
        if (!isOpen()) return; // user closed the panel mid-request
        if (httpStatus === 401) {
          // pairing code revoked (e.g. the PC server restarted)
          clearPairKey();
          state = "error";
          errorMsg = "The server asked to pair again. Open the Coach tab and " +
            "enter the current 6-digit code from the server window, then retry.";
        } else if (httpStatus === 429) {
          state = "error";
          errorMsg = (j && j.error) ||
            "The AI is busy with another request — try again in a minute.";
        } else if (j && j.ok && j.estimate && typeof j.estimate === "object") {
          estimate = j.estimate;
          state = estimate.isFood ? "result" : "nonfood";
        } else {
          state = "error";
          errorMsg = (j && j.error) || "The server returned an unexpected response.";
        }
        renderModal();
      })
      .catch(function (e) {
        if (!isOpen()) return;
        state = "error";
        errorMsg = (e && e.name === "AbortError")
          ? "The estimate took too long and was cancelled. Try again."
          : (isNativeApp()
              ? "Could not reach OptimalFit on your computer. Make sure it's running there and this phone is on the same Wi-Fi."
              : "Could not reach the local server. Is “" + launcherName() + "” still running?");
        renderModal();
      })
      .then(function () { // finally
        if (timer) clearTimeout(timer);
        ctrl = null;
        busy = false;
      });
  }

  /* ---------------- fill the real food form ---------------- */

  function readNum(id, max) {
    var el = document.getElementById(id);
    if (!el) return null;
    var n = parseFloat(el.value);
    if (isNaN(n)) return null;
    return Math.max(0, Math.min(max, n));
  }

  function useValues() {
    var name = document.getElementById("food-name");
    var cal = document.getElementById("food-calories");
    var prot = document.getElementById("food-protein");
    var carb = document.getElementById("food-carbs");
    var fat = document.getElementById("food-fat");
    if (!name || !cal) return;
    if (estimate && estimate.foodName) name.value = estimate.foodName.slice(0, 120);
    var vals = {
      cal: readNum("photo-cal", 10000),
      prot: readNum("photo-prot", 1000),
      carb: readNum("photo-carb", 1000),
      fat: readNum("photo-fat", 1000)
    };
    cal.value = vals.cal != null ? Math.round(vals.cal) : "";
    if (prot) prot.value = vals.prot != null ? vals.prot : "";
    if (carb) carb.value = vals.carb != null ? vals.carb : "";
    if (fat) fat.value = vals.fat != null ? vals.fat : "";
    closeModal();
    var form = document.getElementById("food-form");
    if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    if (name.value) {
      var mt = document.getElementById("food-mealtype");
      if (mt) mt.focus(); // user picks meal type + time, then hits Add meal
    }
  }

  /* ---------------- wiring ---------------- */

  function onFilePicked(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    errorMsg = "";
    reencode(file, function (b64, dataUrl, err) {
      if (!isOpen() || state !== "pick") return;
      if (err) {
        imgB64 = null;
        previewUrl = null;
        errorMsg = err;
      } else {
        imgB64 = b64;
        previewUrl = dataUrl;
      }
      saveDesc();
      renderModal();
    });
  }

  function init() {
    els.area = document.getElementById("food-photo-area");
    els.modal = document.getElementById("photo-modal");
    if (!els.area || !els.modal) return;
    renderButton();

    els.area.addEventListener("click", function (e) {
      if (e.target.closest("#photo-open")) openModal();
    });

    els.modal.addEventListener("click", function (e) {
      if (e.target.closest("[data-close-photo]")) { closeModal(); return; }
      if (e.target.closest("#photo-estimate")) { doEstimate(); return; }
      if (e.target.closest("#photo-use")) { useValues(); return; }
      if (e.target.closest("#photo-again")) {
        state = "pick";
        errorMsg = "";
        renderModal();
      }
    });
    els.modal.addEventListener("change", function (e) {
      if (e.target && e.target.id === "photo-file") onFilePicked(e.target);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) closeModal();
    });
  }

  /** Called by app.js every time the Food tab is opened. */
  function onEnter() {
    if (server !== "ok") checkServer();
    else renderButton(); // re-evaluate the premium gate (sign-in may have happened)
  }

  return { init: init, onEnter: onEnter };
})();
