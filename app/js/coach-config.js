/* ============================================================
   coach-config.js — where the app finds the AI coach server.

   url == ""  (default): same-origin — the app talks to the serve.py
   that served it (desktop browser use, or LAN phone-pairing mode).

   url set: a REMOTE coach server, reachable from anywhere — the
   shipped native app uses this so the AI features work on the phone
   out of the box. Requests carry `key` as X-OF-Key; serve.py in
   --public mode verifies it. The remote server decides whether the
   answer comes from the owner's Claude subscription (CLI mode) or an
   Anthropic API key (.env.llm) — the app never knows or cares.

   OWNER: set url to your tunnel hostname (e.g. from `tailscale funnel`
   or a cloudflared tunnel) and key to the same value you pass serve.py
   via --key / OPTIMALFIT_ACCESS_KEY, then rebuild the app.
   ============================================================ */

window.OF = window.OF || {};

OF.coachServer = {
  url: "",   // e.g. "https://myhost.tailnet.ts.net"
  key: ""    // matching OPTIMALFIT_ACCESS_KEY on the server
};

OF.coachApi = (function () {
  "use strict";

  function base() {
    return (OF.coachServer.url || "").replace(/\/+$/, "");
  }

  /* True when a remote coach server is configured (the native app can use
     the coach without the local-server / pairing flow). */
  function remote() { return !!base(); }

  /* Absolute URL for an /api/* path — remote base when configured, else
     same-origin relative (unchanged behavior). */
  function url(path) { return base() + path; }

  /* The baked access key ("" when not configured — callers fall back to
     the LAN pairing key). */
  function key() { return remote() ? (OF.coachServer.key || "") : ""; }

  return { remote: remote, url: url, key: key };
})();
