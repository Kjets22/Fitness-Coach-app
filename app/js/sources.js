/* ============================================================
   sources.js — "Science & sources": where every number in this app
   comes from, with links the user can actually follow.

   App Store guideline 1.4.1 requires health/medical information to
   carry citations that are EASY TO FIND. That is also just honest:
   the app tells people how much to eat, so it owes them the method
   and the evidence behind it.

   Two layers:
     1. METHODS — the equations and safety limits behind the calorie,
        protein and activity targets, each with a primary source link.
     2. THE EVIDENCE BASE — all 33 entries from OF.evidence, each with
        its claim, how strong the evidence is, and its references.

   Reachable from Settings, from the goal card's targets, and from the
   Insights targets block, so a user reading a calorie number is never
   more than one tap from its source.
   ============================================================ */

window.OF = window.OF || {};

OF.sources = (function () {
  "use strict";
  var U = OF.util;

  /* A PubMed search link resolves for certain and lands the user on the
     real paper — safer than hand-typing a DOI that may be wrong. */
  function pubmed(query) {
    return "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(query);
  }

  /* The methods behind the numbers the app SHOWS. Ordered by how
     directly they affect what the user is told to eat. */
  var METHODS = [
    {
      what: "Your calorie target",
      how: "Resting energy expenditure is estimated with the Mifflin-St Jeor " +
           "equation, then multiplied by an activity factor. Your goal " +
           "(cut / lean bulk / maintain) applies a deficit or surplus on top.",
      cites: [
        { text: "Mifflin MD, St Jeor ST et al. — A new predictive equation for " +
                "resting energy expenditure in healthy individuals. Am J Clin Nutr, 1990.",
          url: pubmed("Mifflin St Jeor new predictive equation resting energy expenditure healthy individuals") },
        { text: "Dietary Guidelines for Americans — estimated calorie needs and activity levels.",
          url: "https://www.dietaryguidelines.gov/" }
      ]
    },
    {
      what: "How fast your weight should change",
      how: "Deficits and surpluses are capped so weight changes at a rate the " +
           "evidence supports — roughly 0.5-1% of body weight per week for fat " +
           "loss, and a much smaller surplus for gaining. Anything faster is " +
           "flagged as unrealistic instead of prescribed.",
      cites: [
        { text: "NIH / NIDDK Body Weight Planner — how intake, activity and weight change relate.",
          url: "https://www.niddk.nih.gov/bwp" },
        { text: "Evidence on rate of loss and preservation of lean mass in athletes.",
          url: pubmed("rate of weight loss lean mass retention athletes energy restriction") }
      ]
    },
    {
      what: "Your protein target",
      how: "Set per kilogram of body weight, higher while you are in a deficit " +
           "(protein protects muscle when calories are low) and while you are " +
           "training for muscle gain.",
      cites: [
        { text: "International Society of Sports Nutrition position stand: protein and exercise.",
          url: pubmed("International Society of Sports Nutrition position stand protein and exercise") },
        { text: "Morton RW et al. — Systematic review and meta-analysis of protein " +
                "supplementation on resistance-training-induced gains. Br J Sports Med, 2018.",
          url: pubmed("Morton protein supplementation resistance training meta-analysis muscle mass") }
      ]
    },
    {
      what: "Safety floors we never go below",
      how: "No matter what a calculation returns, daily targets are never set " +
           "below about 1,500 kcal for men or 1,200 kcal for women, and the app " +
           "tells you plainly when a goal's timeline is not physiologically " +
           "realistic rather than quietly prescribing a crash diet.",
      cites: [
        { text: "Guidance on minimum energy intakes and supervision of very-low-calorie diets.",
          url: pubmed("very low calorie diet safety minimum energy intake medical supervision") },
        { text: "Dietary Guidelines for Americans — meeting nutrient needs within calorie limits.",
          url: "https://www.dietaryguidelines.gov/" }
      ]
    },
    {
      what: "Steps and daily activity",
      how: "Activity targets follow public-health guidance on weekly activity, " +
           "scaled to the activity level you told us.",
      cites: [
        { text: "World Health Organization — guidelines on physical activity and sedentary behaviour.",
          url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity" }
      ]
    },
    {
      what: "Your training program",
      how: "Weekly set volume, rep ranges, effort (reps in reserve) and rest " +
           "periods come from the resistance-training literature, then adapt to " +
           "what you actually log.",
      cites: [
        { text: "Schoenfeld BJ, Ogborn D, Krieger JW — Dose-response relationship " +
                "between weekly resistance-training volume and muscle mass. J Sports Sci, 2017.",
          url: pubmed("Schoenfeld Ogborn Krieger dose-response weekly resistance training volume muscle") },
        { text: "Evidence on training to failure, reps in reserve and hypertrophy.",
          url: pubmed("resistance training proximity to failure reps in reserve hypertrophy") }
      ]
    }
  ];

  var DISCLAIMER =
    "OptimalFit is a fitness and wellness app, not a medical device. The " +
    "information here is general fitness and nutrition guidance computed from " +
    "what you log — it is not medical advice, diagnosis or treatment. Talk to a " +
    "qualified healthcare professional before making significant changes to your " +
    "diet or exercise, especially if you are pregnant, under 18, or have any " +
    "medical condition. If something hurts or you feel unwell, stop and seek " +
    "medical help.";

  function e(s) { return U.esc(s); }

  function citeHtml(c) {
    return '<li><a href="' + e(c.url) + '" target="_blank" rel="noopener noreferrer">' +
      e(c.text) + '</a></li>';
  }

  function methodsHtml() {
    return METHODS.map(function (m) {
      return '<div class="src-item">' +
        '<h3 class="src-what">' + e(m.what) + '</h3>' +
        '<p class="src-how">' + e(m.how) + '</p>' +
        '<ul class="src-cites">' + m.cites.map(citeHtml).join("") + '</ul>' +
        '</div>';
    }).join("");
  }

  /** Every entry in the on-device evidence base, with its grade and refs. */
  function evidenceHtml() {
    var all = [];
    try { all = (OF.evidence && OF.evidence.all) ? OF.evidence.all() : []; } catch (err) { all = []; }
    if (!all.length) return "";
    return '<details class="src-details"><summary>The full evidence base (' +
      all.length + ' entries the coach reasons from)</summary>' +
      all.map(function (en) {
        var refs = (en.refs || []).map(function (r) {
          return '<li><a href="' + e(pubmed(r)) + '" target="_blank" rel="noopener noreferrer">' +
            e(r) + '</a></li>';
        }).join("");
        return '<div class="src-ev">' +
          '<div class="src-ev-head"><strong>' + e(en.recommendation || en.id) + '</strong>' +
          '<span class="src-grade src-grade-' + e(en.evidence || "") + '">' +
          e(en.evidence || "") + ' evidence</span></div>' +
          (en.why ? '<p class="src-why muted small">' + e(en.why) + '</p>' : '') +
          (refs ? '<ul class="src-cites">' + refs + '</ul>' : '') +
          '</div>';
      }).join("") + '</details>';
  }

  /** The whole panel. Rendered into Settings and into the modal. */
  function panelHtml() {
    return '<p class="src-intro">Every number this app gives you — calories, ' +
      'protein, steps, sets — comes from published research or public-health ' +
      'guidance, not from opinion. Here is the method behind each one and where ' +
      'to read the source yourself.</p>' +
      methodsHtml() +
      evidenceHtml() +
      '<p class="src-disclaimer">' + e(DISCLAIMER) + '</p>';
  }

  /* ---- the modal opened from a target/goal "sources" link ---- */
  var modalEl = null;
  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "metric-modal";
    modalEl.hidden = true;
    modalEl.innerHTML =
      '<div class="metric-modal-backdrop" data-close-src></div>' +
      '<div class="metric-modal-panel" role="dialog" aria-modal="true" aria-labelledby="src-modal-title">' +
      '<div class="metric-modal-head"><h2 id="src-modal-title">Science &amp; sources</h2>' +
      '<button type="button" class="metric-modal-close" data-close-src aria-label="Close">&times;</button></div>' +
      '<div class="src-body"></div></div>';
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-close-src]")) close();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && modalEl && !modalEl.hidden) close();
    });
    return modalEl;
  }
  function open() {
    var m = ensureModal();
    m.querySelector(".src-body").innerHTML = panelHtml();
    m.hidden = false;
    document.body.classList.add("metric-modal-open");
  }
  function close() {
    if (modalEl) modalEl.hidden = true;
    document.body.classList.remove("metric-modal-open");
  }

  /** Small inline link to drop next to any displayed target. */
  function linkHtml(label) {
    return '<button type="button" class="src-link" data-open-sources>' +
      U.esc(label || "How these numbers are calculated · sources") + '</button>';
  }

  function init() {
    // one delegated listener covers every [data-open-sources] link anywhere
    document.addEventListener("click", function (ev) {
      if (ev.target.closest && ev.target.closest("[data-open-sources]")) {
        ev.preventDefault();
        open();
      }
    });
    var host = document.getElementById("settings-sources");
    if (host) host.innerHTML = panelHtml();
  }

  return { init: init, open: open, panelHtml: panelHtml, linkHtml: linkHtml,
           DISCLAIMER: DISCLAIMER };
})();
