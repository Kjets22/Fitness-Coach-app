/* ============================================================
   health-import.js — import steps / weight / sleep / water from
   phone health apps (Settings tab card).

   APPLE HEALTH: the user exports export.zip from the iPhone
   Health app, extracts it, and picks export.xml. That file can
   be 100+ MB, so it is parsed with a STREAMING approach: the
   File is read in slices, decoded incrementally, and complete
   lines are scanned with regexes — never DOMParser, never the
   whole file in memory. Extracted:
     HKQuantityTypeIdentifierStepCount   -> steps (summed per day
                                            PER SOURCE, then the max
                                            source total wins — iPhone
                                            + Watch both record the
                                            same walk, so summing
                                            across sources double-
                                            counts; QA3-3)
     HKQuantityTypeIdentifierBodyMass    -> body weight (kg/lb ->
                                            kg, one per day, latest wins)
     HKCategoryTypeIdentifierSleepAnalysis (Asleep* intervals)
                                         -> per-night sleep, date =
                                            wake date, quality 3;
                                            overlapping/adjacent
                                            intervals are MERGED
                                            (union) before summing so
                                            iPhone + Watch logging the
                                            same night don't double
                                            the duration (QA3-4)
     HKQuantityTypeIdentifierDietaryWater-> water (ml per day)

   SAMSUNG HEALTH: "Download personal data" CSVs. Handles the
   junk first line before the real header. Recognized:
     step_daily_trend CSV (day_time/count[/source_type]) -> steps
     weight CSV (start_time/weight)                      -> body weight

   MERGE RULES (all through OF.storage, metric internally):
     steps: one record per day — update if the day exists
     water: one imported record per day — update the existing
            record if the day has exactly one, skip if the user
            already logged several entries that day
     body / sleep: skip days that already have an entry

   A preview (counts + date range per type, with checkboxes) is
   shown BEFORE anything is written. All rendered text -> U.esc.
   ============================================================ */

window.OF = window.OF || {};

OF.healthImport = (function () {
  "use strict";

  var U = OF.util, S = OF.storage;
  var els = {};
  var pending = null; // parsed bundle awaiting user confirmation

  var KG_PER_LB = 0.45359237;
  var ML_PER_FLOZ_US = 29.5735295625;

  /* ================= shared helpers ================= */

  function showMsg(text) { if (els.msg) els.msg.textContent = text || ""; }

  function showProgress(frac, label) {
    if (!els.progress) return;
    if (frac == null) { els.progress.hidden = true; els.progress.innerHTML = ""; return; }
    els.progress.hidden = false;
    els.progress.innerHTML =
      '<p class="form-hint">' + U.esc(label || "Reading file…") + " " +
      Math.round(frac * 100) + "%</p>" + U.progressBar(frac, "var(--accent)");
  }

  /** "2026-07-07" -> day number (UTC-based; only used for differences). */
  function dayNum(iso) {
    return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  }

  function dateRange(recs) {
    var min = null, max = null;
    recs.forEach(function (r) {
      if (min === null || r.date < min) min = r.date;
      if (max === null || r.date > max) max = r.date;
    });
    return min === null ? "" : (min === max ? U.fmtDate(min) : U.fmtDate(min) + " – " + U.fmtDate(max));
  }

  /* ================= Apple Health export.xml (streaming) ================= */

  var RE_VALUE = /\svalue="([^"]*)"/;
  var RE_UNIT = /\sunit="([^"]*)"/;
  var RE_SOURCE = /\ssourceName="([^"]*)"/;
  var MAX_DAY_STEPS = 200000; // same sanity cap as the manual steps form
  // captures: date, HH, MM  (timezone suffix intentionally ignored — Apple
  // writes record-local times, which is what the user means by "that day")
  var RE_START = /\sstartDate="(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/;
  var RE_END = /\sendDate="(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/;

  function parseAppleXML(file, onProgress) {
    var CHUNK = 4 * 1024 * 1024;
    var decoder = new TextDecoder("utf-8");
    var carry = "";
    var offset = 0;
    var sawHealthTag = false;
    var acc = {
      steps: {},   // date -> {sourceName -> summed count} (max source wins later)
      weight: {},  // date -> {kg, key} (key = start minute index; latest wins)
      water: {},   // date -> ml
      sleep: {}    // wakeDate -> [{s, e}] asleep intervals (minute keys), merged later
    };

    function processLine(line) {
      var i = line.indexOf("<Record");
      if (i === -1) {
        if (!sawHealthTag && (line.indexOf("<HealthData") !== -1 || line.indexOf("<?xml") !== -1)) {
          sawHealthTag = true;
        }
        return;
      }
      sawHealthTag = true;

      var sm = RE_START.exec(line);
      if (!sm) return;
      var sDate = sm[1], sKey = dayNum(sDate) * 1440 + (+sm[2]) * 60 + (+sm[3]);
      var vm, v;

      if (line.indexOf("HKQuantityTypeIdentifierStepCount") !== -1) {
        vm = RE_VALUE.exec(line);
        v = vm ? parseFloat(vm[1]) : NaN;
        if (isFinite(v) && v > 0) {
          // QA3-3: iPhone AND Watch both log the same walk — sum per SOURCE,
          // pick the biggest source total per day in finishApple().
          var srcm = RE_SOURCE.exec(line);
          var src = srcm ? srcm[1] : "";
          var day = acc.steps[sDate] || (acc.steps[sDate] = {});
          day[src] = (day[src] || 0) + v;
        }

      } else if (line.indexOf("HKQuantityTypeIdentifierBodyMass") !== -1) {
        // NOT BodyMassIndex — that's a different type string, checked below
        if (line.indexOf("HKQuantityTypeIdentifierBodyMassIndex") !== -1) return;
        vm = RE_VALUE.exec(line);
        v = vm ? parseFloat(vm[1]) : NaN;
        if (!isFinite(v) || v <= 0) return;
        var um = RE_UNIT.exec(line);
        var unit = um ? um[1] : "kg";
        var kg = unit === "kg" ? v
          : unit === "lb" ? v * KG_PER_LB
          : unit === "g" ? v / 1000
          : null; // unknown unit: skip rather than guess
        if (kg === null || kg < 20 || kg > 400) return;
        var cur = acc.weight[sDate];
        if (!cur || sKey >= cur.key) acc.weight[sDate] = { kg: kg, key: sKey };

      } else if (line.indexOf("HKQuantityTypeIdentifierDietaryWater") !== -1) {
        vm = RE_VALUE.exec(line);
        v = vm ? parseFloat(vm[1]) : NaN;
        if (!isFinite(v) || v <= 0) return;
        var wu = RE_UNIT.exec(line);
        var wUnit = wu ? wu[1] : "mL";
        var ml = wUnit === "mL" ? v
          : wUnit === "L" ? v * 1000
          : wUnit === "fl_oz_us" ? v * ML_PER_FLOZ_US
          : null;
        if (ml === null) return;
        acc.water[sDate] = (acc.water[sDate] || 0) + ml;

      } else if (line.indexOf("HKCategoryTypeIdentifierSleepAnalysis") !== -1) {
        // Only actually-asleep intervals (Asleep / AsleepCore / AsleepDeep /
        // AsleepREM / AsleepUnspecified); InBed and Awake are excluded.
        vm = RE_VALUE.exec(line);
        if (!vm || vm[1].indexOf("Asleep") === -1) return;
        var em = RE_END.exec(line);
        if (!em) return;
        var eDate = em[1], eKey = dayNum(eDate) * 1440 + (+em[2]) * 60 + (+em[3]);
        var dur = eKey - sKey;
        if (dur <= 0 || dur > 24 * 60) return; // nonsense interval
        // QA3-4: keep the raw intervals; overlapping ones (iPhone + Watch
        // logging the same night) are merged in finishApple().
        (acc.sleep[eDate] = acc.sleep[eDate] || []).push({ s: sKey, e: eKey });
      }
    }

    function processText(text) {
      // Every value we extract lives in a record's OPENING tag, so split on
      // the "<Record" boundary rather than on "\n". This handles the usual
      // one-record-per-line export AND a minified/newline-free export.xml
      // (whole file on a single line) — a plain \n-split silently parsed only
      // the first record of the latter and buffered the entire file in memory.
      var from = 0, start, gt;
      while ((start = text.indexOf("<Record", from)) !== -1) {
        gt = text.indexOf(">", start);
        if (gt === -1) break;               // opening tag straddles the chunk -> carry
        processLine(text.slice(start, gt)); // isolate one record's opening tag
        from = gt + 1;
      }
      // No record consumed yet: let processLine sniff a leading <?xml/<HealthData
      // header (sets sawHealthTag). Guard the partial-"<Record" tail so it isn't
      // parsed here and then again once its ">" arrives (which would double-count).
      if (from === 0 && text.indexOf("<Record") === -1) processLine(text);
      return text.slice(from); // header / incomplete tail -> carry
    }

    return new Promise(function (resolve, reject) {
      function step() {
        if (offset >= file.size) {
          carry += decoder.decode(); // flush the streaming decoder
          if (carry) processLine(carry);
          if (!sawHealthTag) {
            reject(new Error("That XML file doesn't look like an Apple Health export " +
              "(no <HealthData>/<Record> entries found)."));
            return;
          }
          resolve(finishApple(acc));
          return;
        }
        file.slice(offset, offset + CHUNK).arrayBuffer().then(function (buf) {
          offset += CHUNK;
          carry = processText(carry + decoder.decode(buf, { stream: true }));
          if (onProgress) onProgress(Math.min(1, offset / file.size));
          setTimeout(step, 0); // yield so the tab never freezes
        }).catch(reject);
      }
      step();
    });
  }

  /** minute key -> "HH:MM" within its day. */
  function keyToHM(key) {
    var m = ((key % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function finishApple(acc) {
    var types = {};
    var recs;

    // Steps: each source's records are summed separately; the biggest single
    // source total is the day's count (the Health app itself dedupes multi-
    // device data — the raw export does not). Mirrors the Samsung "-2 total /
    // max per day" logic. Days beyond the manual form's sanity cap are dropped.
    recs = [];
    Object.keys(acc.steps).sort().forEach(function (d) {
      var bySrc = acc.steps[d], best = 0;
      Object.keys(bySrc).forEach(function (s) { if (bySrc[s] > best) best = bySrc[s]; });
      best = Math.round(best);
      if (best > 0 && best <= MAX_DAY_STEPS) recs.push({ date: d, count: best });
    });
    if (recs.length) types.steps = { label: "Daily steps", recs: recs };

    recs = Object.keys(acc.weight).sort().map(function (d) {
      return { date: d, weightKg: Math.round(acc.weight[d].kg * 100) / 100 };
    });
    if (recs.length) types.body = { label: "Body weight", recs: recs };

    recs = Object.keys(acc.water).sort().map(function (d) {
      return { date: d, amountMl: Math.round(acc.water[d]) };
    });
    if (recs.length) types.water = { label: "Water", recs: recs };

    recs = [];
    Object.keys(acc.sleep).sort().forEach(function (d) {
      // Merge overlapping/adjacent asleep intervals first (sort by start,
      // sweep, union) so multi-device nights aren't double-counted; the
      // night's duration is the size of the union, bed/wake its extremes.
      var iv = acc.sleep[d].slice().sort(function (a, b) { return a.s - b.s; });
      var merged = [], cur = null;
      iv.forEach(function (x) {
        if (cur && x.s <= cur.e) { if (x.e > cur.e) cur.e = x.e; }
        else { cur = { s: x.s, e: x.e }; merged.push(cur); }
      });
      var min = 0;
      merged.forEach(function (m) { min += m.e - m.s; });
      // Keep plausible nights only (matches the app's own 20h form cap).
      if (!merged.length || min < 10 || min > 20 * 60) return;
      recs.push({
        date: d,
        bedTime: keyToHM(merged[0].s),
        wakeTime: keyToHM(merged[merged.length - 1].e),
        durationMin: Math.round(min), quality: 3, notes: ""
      });
    });
    if (recs.length) types.sleep = { label: "Sleep (quality defaults to 3/5)", recs: recs };

    return { source: "Apple Health (export.xml)", types: types };
  }

  /* ================= Samsung Health CSVs ================= */

  /** Minimal CSV line parser (handles quoted fields). */
  function csvLine(line) {
    var out = [], cur = "", inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  /** ms-epoch or "YYYY-MM-DD…" -> "YYYY-MM-DD" (epoch interpreted as UTC,
      which is how Samsung stores day_time), or null. */
  function csvDate(v) {
    v = (v || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    if (/^\d{12,}$/.test(v)) {
      var d = new Date(Number(v));
      return isNaN(d) ? null : d.toISOString().slice(0, 10);
    }
    return null;
  }

  function parseSamsungCSV(text) {
    var lines = text.split(/\r?\n/);
    // Samsung CSVs start with a junk metadata line before the real header —
    // sniff the first few lines for one with recognizable columns.
    var header = null, headerIdx = -1;
    for (var i = 0; i < Math.min(lines.length, 5); i++) {
      var cells = csvLine(lines[i]).map(function (c) { return c.trim().toLowerCase(); });
      var hasDate = cells.indexOf("day_time") !== -1 || cells.indexOf("start_time") !== -1 ||
                    cells.indexOf("date") !== -1;
      if (hasDate && (cells.indexOf("count") !== -1 || cells.indexOf("weight") !== -1)) {
        header = cells; headerIdx = i; break;
      }
    }
    if (!header) {
      throw new Error("Couldn't find step or weight columns in that CSV. Expected a Samsung " +
        "Health step_daily_trend or weight file (from Settings → Download personal data).");
    }
    var col = {};
    header.forEach(function (name, idx) { if (!(name in col)) col[name] = idx; });
    var dateCol = "day_time" in col ? col.day_time : "start_time" in col ? col.start_time : col.date;

    var rows = [];
    for (var j = headerIdx + 1; j < lines.length; j++) {
      if (!lines[j]) continue;
      var c = csvLine(lines[j]);
      if (c.length > 1) rows.push(c);
    }

    if ("count" in col) return samsungSteps(rows, col, dateCol);
    return samsungWeight(rows, col, dateCol);
  }

  function samsungSteps(rows, col, dateCol) {
    // step_daily_trend has one row per source; source_type -2 is the combined
    // total. Prefer those rows when present, else take the max per day.
    var hasSrc = "source_type" in col;
    var byDate = {};   // date -> {v, isTotal}
    rows.forEach(function (c) {
      var date = csvDate(c[dateCol]);
      var v = parseFloat(c[col.count]);
      if (!date || !isFinite(v) || v < 0) return;
      var isTotal = hasSrc && (c[col.source_type] || "").trim() === "-2";
      var cur = byDate[date];
      if (!cur || (isTotal && !cur.isTotal) || (isTotal === !!cur.isTotal && v > cur.v)) {
        byDate[date] = { v: v, isTotal: isTotal };
      }
    });
    // Drop days beyond the manual form's sanity cap, same as the Apple path.
    var recs = [];
    Object.keys(byDate).sort().forEach(function (d) {
      var count = Math.round(byDate[d].v);
      if (count <= MAX_DAY_STEPS) recs.push({ date: d, count: count });
    });
    if (!recs.length) throw new Error("No usable step rows found in that CSV.");
    return { source: "Samsung Health (steps CSV)", types: { steps: { label: "Daily steps", recs: recs } } };
  }

  function samsungWeight(rows, col, dateCol) {
    var byDate = {}; // date -> {kg, key}
    rows.forEach(function (c) {
      var raw = (c[dateCol] || "").trim();
      var date = csvDate(raw);
      var v = parseFloat(c[col.weight]); // Samsung stores kg
      if (!date || !isFinite(v) || v < 20 || v > 400) return;
      var cur = byDate[date];
      if (!cur || raw >= cur.key) byDate[date] = { kg: v, key: raw }; // latest wins
    });
    var recs = Object.keys(byDate).sort().map(function (d) {
      return { date: d, weightKg: Math.round(byDate[d].kg * 100) / 100 };
    });
    if (!recs.length) throw new Error("No usable weight rows found in that CSV.");
    return { source: "Samsung Health (weight CSV)", types: { body: { label: "Body weight", recs: recs } } };
  }

  /* ================= preview + import ================= */

  var TYPE_ORDER = ["steps", "water", "body", "sleep"];

  function renderPreview(bundle) {
    pending = bundle;
    var keys = TYPE_ORDER.filter(function (t) { return bundle.types[t]; });
    if (!keys.length) {
      els.preview.innerHTML = "";
      showMsg("Parsed the file, but found none of the supported data types " +
        "(steps, weight, sleep, water).");
      return;
    }
    var html = '<div class="chart-mini-label">Found in ' + U.esc(bundle.source) + '</div>' +
      '<ul class="hi-preview-list">' +
      keys.map(function (t) {
        var info = bundle.types[t];
        return '<li><label><input type="checkbox" checked data-type="' + U.esc(t) + '">' +
          '<span><strong>' + U.esc(info.label) + '</strong> — ' + info.recs.length +
          ' day' + (info.recs.length === 1 ? "" : "s") +
          ' <span class="hi-range">(' + U.esc(dateRange(info.recs)) + ')</span></span></label></li>';
      }).join("") +
      '</ul>' +
      '<div class="form-actions">' +
      '<button type="button" class="btn primary" id="hi-import">Import selected</button>' +
      '<button type="button" class="btn ghost" id="hi-cancel">Cancel</button></div>';
    els.preview.innerHTML = html;
    document.getElementById("hi-import").addEventListener("click", doImport);
    document.getElementById("hi-cancel").addEventListener("click", function () {
      pending = null;
      els.preview.innerHTML = "";
      showMsg("Import cancelled — nothing was changed.");
    });
    showMsg("Nothing is imported yet — review the preview and confirm.");
  }

  function doImport() {
    if (!pending) return;
    var selected = {};
    els.preview.querySelectorAll("input[data-type]").forEach(function (cb) {
      if (cb.checked) selected[cb.getAttribute("data-type")] = true;
    });
    var parts = [], failed = false;

    if (selected.steps && pending.types.steps) {
      var existing = {};
      S.getAll("steps").forEach(function (r) { existing[r.date] = r; });
      var a = 0, u = 0;
      pending.types.steps.recs.forEach(function (rec) {
        if (failed) return;
        var hit = existing[rec.date];
        var ok = hit ? S.update("steps", hit.id, { count: rec.count })
                     : S.add("steps", { date: rec.date, count: rec.count });
        if (!ok) { failed = true; return; }
        hit ? u++ : a++;
      });
      parts.push("steps: " + a + " added, " + u + " updated");
    }

    if (!failed && selected.water && pending.types.water) {
      var byDate = {};
      S.getAll("water").forEach(function (r) {
        (byDate[r.date] = byDate[r.date] || []).push(r);
      });
      var wa = 0, wu = 0, ws = 0;
      pending.types.water.recs.forEach(function (rec) {
        if (failed) return;
        var have = byDate[rec.date] || [];
        if (have.length > 1) { ws++; return; } // user logged several entries: keep them
        var ok = have.length === 1
          ? S.update("water", have[0].id, { amountMl: rec.amountMl })
          : S.add("water", { date: rec.date, amountMl: rec.amountMl });
        if (!ok) { failed = true; return; }
        have.length ? wu++ : wa++;
      });
      parts.push("water: " + wa + " added, " + wu + " updated" +
        (ws ? ", " + ws + " skipped (multiple manual entries that day)" : ""));
    }

    if (!failed && selected.body && pending.types.body) {
      var bodyDates = {};
      S.getAll("body").forEach(function (r) { bodyDates[r.date] = true; });
      var ba = 0, bs = 0;
      pending.types.body.recs.forEach(function (rec) {
        if (failed) return;
        if (bodyDates[rec.date]) { bs++; return; }
        if (!S.add("body", { date: rec.date, weightKg: rec.weightKg,
                             bodyFatPct: null, muscleMassPct: null, notes: "" })) {
          failed = true; return;
        }
        ba++;
      });
      parts.push("weight: " + ba + " added" + (bs ? ", " + bs + " skipped (day already logged)" : ""));
    }

    if (!failed && selected.sleep && pending.types.sleep) {
      var sleepDates = {};
      S.getAll("sleep").forEach(function (r) { sleepDates[r.date] = true; });
      var sa = 0, ss = 0;
      pending.types.sleep.recs.forEach(function (rec) {
        if (failed) return;
        if (sleepDates[rec.date]) { ss++; return; }
        if (!S.add("sleep", rec)) { failed = true; return; }
        sa++;
      });
      parts.push("sleep: " + sa + " added" + (ss ? ", " + ss + " skipped (night already logged)" : ""));
    }

    pending = null;
    els.preview.innerHTML = "";
    if (OF.settings && OF.settings.refreshAll) OF.settings.refreshAll();
    if (failed) {
      showMsg("Import stopped early — browser storage is full or blocked. " +
        "Some records may have been imported; the counts above are incomplete.");
    } else {
      showMsg(parts.length ? "Import complete — " + parts.join("; ") + "."
                           : "Nothing selected — no changes made.");
    }
  }

  /* ================= file dispatch ================= */

  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    pending = null;
    els.preview.innerHTML = "";
    showMsg("");

    file.slice(0, 4).arrayBuffer().then(function (head) {
      var b = new Uint8Array(head);
      if (b[0] === 0x50 && b[1] === 0x4B) { // "PK" — a zip archive
        showMsg("That's the zip archive itself. Extract it first (right-click → Extract All " +
          "on this PC, or tap it in the iPhone Files app), then pick the export.xml inside.");
        return null;
      }
      if (/\.xml$/i.test(file.name)) return "xml";
      if (/\.csv$/i.test(file.name)) return "csv";
      // Unknown extension: sniff the first bytes.
      return file.slice(0, 4096).text().then(function (t) {
        return t.indexOf("<") === 0 || t.indexOf("<?xml") !== -1 ? "xml" : "csv";
      });
    }).then(function (kind) {
      if (!kind) return;
      if (kind === "xml") {
        showProgress(0, "Reading Apple Health export…");
        return parseAppleXML(file, function (frac) {
          showProgress(frac, "Reading Apple Health export…");
        }).then(function (bundle) {
          showProgress(null);
          renderPreview(bundle);
        });
      }
      showProgress(0.5, "Reading CSV…");
      return file.text().then(function (text) {
        showProgress(null);
        renderPreview(parseSamsungCSV(text));
      });
    }).catch(function (err) {
      showProgress(null);
      els.preview.innerHTML = "";
      showMsg("Could not import that file: " +
        ((err && err.message) || "unrecognized format") +
        " Supported: Apple Health export.xml, Samsung Health step_daily_trend / weight CSVs.");
    });
  }

  /* ================= wiring ================= */

  function init() {
    els.btn = document.getElementById("btn-health-import");
    els.file = document.getElementById("health-file");
    els.progress = document.getElementById("health-progress");
    els.preview = document.getElementById("health-preview");
    els.msg = document.getElementById("health-msg");
    if (!els.btn || !els.file) return;
    els.btn.addEventListener("click", function () { els.file.click(); });
    els.file.addEventListener("change", onFile);
  }

  // parseAppleXML / parseSamsungCSV exported for testing without the picker.
  return { init: init, parseAppleXML: parseAppleXML, parseSamsungCSV: parseSamsungCSV };
})();
