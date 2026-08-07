/* ============================================================
   ai-job.js — background-safe wrapper for long AI requests
   (meal-photo estimate, physique analysis).

   iOS kills in-flight fetches the moment the user switches apps,
   which used to surface as "could not reach the server" even
   though the Mac was happily computing the answer. This helper
   makes any long POST survive that:

     1. POST with { wantJob:true, jobId:<client id> } — the server
        replies { ok, jobId } immediately and computes in a worker.
     2. Poll GET /api/coach/result?id=… until done (visibility-
        aware: an immediate poll fires when the app returns to the
        foreground; quiet misses while hidden are normal).
     3. If the POST itself died because the app was backgrounded,
        re-send it on return — the SAME jobId re-attaches to the
        already-running job server-side (no duplicate LLM call).

   request(opts) -> Promise<{ status, body }>
     opts: { path, payload, apiUrl(p), apiHeaders(h), timeoutMs }
   Resolves with the FINAL response body ({ok, estimate/analysis}
   or {ok:false, error}) so callers keep their existing handling;
   rejects only for total-timeout (name "AbortError") or the
   network being down while the app is visibly in the foreground.
   Older servers that answer inline (no jobId) resolve directly.
   ============================================================ */

window.OF = window.OF || {};

OF.aiJob = (function () {
  "use strict";

  var POLL_MS = 4000;
  var MAX_VISIBLE_MISSES = 12;   // ~48s of failed polls while foregrounded
  var MAX_RESENDS = 3;

  function uid() {
    // job ids are the handle to a stored analysis, so prefer a CSPRNG;
    // Math.random is only the fallback for ancient webviews
    try {
      var a = new Uint8Array(16);
      crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    } catch (e) {
      return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
    }
  }

  function request(opts) {
    var path = opts.path;
    var apiUrl = opts.apiUrl;
    var apiHeaders = opts.apiHeaders;
    // NOTE: this deadline is wall-clock and includes time the app spent
    // backgrounded — the exact case this module exists to survive. It must
    // therefore track the SERVER's job TTL (15 min), not the per-request
    // CLI budget (120 s), or a finished answer expires client-side while
    // it is sitting on the server waiting to be collected.
    var timeoutMs = opts.timeoutMs || 15 * 60 * 1000;
    var jobId = uid();
    var payload = Object.assign({}, opts.payload, { wantJob: true, jobId: jobId });

    return new Promise(function (resolve, reject) {
      var settled = false;
      var pollTimer = null;
      var misses = 0;
      var resends = 0;
      var deadline = Date.now() + timeoutMs;

      function cleanup() {
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        document.removeEventListener("visibilitychange", onVisible);
      }
      function settle(fn, v) {
        if (settled) return;
        settled = true;
        cleanup();
        fn(v);
      }
      function timedOut() {
        if (Date.now() < deadline) return false;
        var e = new Error("timeout");
        e.name = "AbortError";
        settle(reject, e);
        return true;
      }

      var awaitingResend = false;
      function onVisible() {
        if (document.hidden || settled) return;
        if (awaitingResend) { awaitingResend = false; post(); }
        else if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; poll(); }
      }
      document.addEventListener("visibilitychange", onVisible);

      function post() {
        if (settled || timedOut()) return;
        var httpStatus = 0;
        fetch(apiUrl(path), {
          method: "POST",
          headers: apiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload)
        })
          .then(function (res) {
            httpStatus = res.status;
            return res.json().catch(function () {
              return { ok: false, error: "The server hit an error (HTTP " +
                res.status + "). Try again in a minute." };
            });
          })
          .then(function (j) {
            if (settled) return;
            if (j && j.ok && j.jobId) { misses = 0; poll(); }  // job registered
            else settle(resolve, { status: httpStatus, body: j }); // legacy/error/401/429
          })
          .catch(function (e) {
            if (settled) return;
            if (document.hidden && resends < MAX_RESENDS) {
              // classic backgrounding kill — hold and re-send on return;
              // the same jobId re-attaches if the server DID get the POST
              resends++;
              awaitingResend = true;
            } else {
              settle(reject, e);
            }
          });
      }

      function poll() {
        if (settled || timedOut()) return;
        var pollStatus = 0;
        fetch(apiUrl("/api/coach/result?id=" + encodeURIComponent(jobId)),
              { cache: "no-store", headers: apiHeaders({}) })
          .then(function (res) {
            pollStatus = res.status;
            // a 5xx from the tunnel edge carries an HTML body — without this
            // the parse failure looked like a dropped connection and the user
            // was told "check your internet" for a server-side fault
            return res.json().catch(function () {
              return { ok: false, httpError: true, error: res.ok
                ? "The server returned an unreadable response — try again."
                : "The server hit an error (HTTP " + res.status + "). Try again in a minute." };
            });
          })
          .then(function (j) {
            if (settled) return;
            misses = 0;
            // 401 is terminal: the caller has real pairing/key handling for it
            if (pollStatus === 401) {
              settle(resolve, { status: 401, body: j || { ok: false } });
              return;
            }
            if (j && j.httpError) {
              settle(resolve, { status: pollStatus, body: j });
              return;
            }
            if (j && j.status === "pending") {
              pollTimer = setTimeout(poll, POLL_MS);
            } else if (j && j.status === "done" && j.result) {
              settle(resolve, { status: 200, body: j.result });
            } else if (j && j.status === "error") {
              settle(resolve, { status: 200, body: { ok: false, error: j.error } });
            } else if (j && j.status === "unknown" && resends < MAX_RESENDS) {
              // server restarted and lost the job — re-send the request
              resends++;
              post();
            } else {
              settle(resolve, { status: 200, body: { ok: false, error:
                "The server restarted before the answer was saved. Tap Try again." } });
            }
          })
          .catch(function () {
            if (settled) return;
            // failed polls are NORMAL while hidden (JS frozen / radio off);
            // only give up after sustained failures with the app visible
            misses++;
            if (misses >= MAX_VISIBLE_MISSES && !document.hidden) {
              settle(reject, new Error("network"));
            } else {
              pollTimer = setTimeout(poll, POLL_MS);
            }
          });
      }

      post();
    });
  }

  return { request: request };
})();
