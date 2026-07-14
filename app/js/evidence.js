/* ============================================================
   evidence.js — the Evidence Knowledge Base (Coach 2.0).

   Structured, versioned exercise-science knowledge compiled from
   meta-analyses and systematic reviews (2016-2025; see refs on each
   entry). Every programming decision the coach makes can point at an
   entry here and answer "why?" in plain English.

   Entry shape: { id, topic, recommendation, numbers, evidence
   ("strong"|"moderate"|"mixed"|"practice-based"), why (client-facing
   1-2 sentences), individualNote (how individuals vary + what user
   data settles it), refs [verifiable citations] }.

   The DATA block below is generated from the research compilation —
   edit entries there (or recompile) rather than sprinkling numbers
   through the code. Consumers: trainer.js (volume/rep/rest/frequency
   parameters + why annotations), coach-learn.js (MEV/MRV bands and
   priors), coach.js + serve.py (compact citations for the LLM),
   coach-intake.js (educational blurbs).
   ============================================================ */

window.OF = window.OF || {};

OF.evidence = (function () {
  "use strict";

  var DATA = {
  "version": 1,
  "compiled": "2026-07-14",
  "entries": [
    {
      "id": "volume-minimum-effective",
      "topic": "volume",
      "recommendation": "Meaningful hypertrophy occurs from as few as ~4 hard sets per muscle per week; even 1 hard set 2-3x/week grows muscle in novices. Use ~4-6 sets/week as a maintenance/minimum-effective floor when time-crunched or in a deep deficit.",
      "numbers": {
        "minEffectiveSetsPerMuscleWeek": 4,
        "maintenanceSetsPerMuscleWeek": [
          4,
          6
        ],
        "singleSetStillGrows": true
      },
      "evidence": "strong",
      "why": "You don't need a huge program to grow — a handful of hard sets per muscle each week already drives most of the result, so a busy week is not a wasted week.",
      "individualNote": "Some 'single-set non-responders' start responding when volume is raised; if progress stalls at low volume, add sets before concluding you can't grow. Track sets-per-muscle and month-over-month lifts to settle it.",
      "refs": [
        "Schoenfeld, Ogborn & Krieger (2017) - Dose-response weekly volume & muscle mass / J Sports Sci",
        "Higher RT volume offsets hypertrophy nonresponsiveness in older adults (2024) / J Appl Physiol"
      ]
    },
    {
      "id": "volume-hypertrophy-range",
      "topic": "volume",
      "recommendation": "For hypertrophy, target roughly 10-20 hard sets per muscle group per week as the productive optimal band. Near-maximal growth is reached around ~10 sets/week; more sets add a little more but with diminishing returns. Novices do well on the lower end; intermediates/advanced often need the upper end or beyond.",
      "numbers": {
        "setsPerMuscleWeek": {
          "novice": [
            8,
            12
          ],
          "intermediate": [
            12,
            20
          ],
          "advanced": [
            15,
            25
          ]
        },
        "nearMaximalThreshold": 10,
        "perSetHypertrophyEffect": "~0.37% additional muscle per added weekly set"
      },
      "evidence": "strong",
      "why": "More sets generally means more muscle, but the curve flattens — going from 10 to 20 sets adds less than going from 4 to 10, so chase volume gradually rather than maxing it out day one.",
      "individualNote": "Optimal volume is highly individual and varies by muscle, recovery, and life stress. Response varies widely between people; log weekly sets vs. measured/visual progress over 8-12 weeks to find your personal sweet spot.",
      "refs": [
        "Schoenfeld, Ogborn & Krieger (2017) - Dose-response weekly volume / J Sports Sci",
        "Pelland et al. (2025) - Resistance Training Dose Response meta-regressions / Sports Medicine"
      ]
    },
    {
      "id": "volume-diminishing-negative",
      "topic": "volume",
      "recommendation": "Hypertrophy keeps inching up with volume across the studied range (into the 20s of sets/week for advanced lifters) but with clear diminishing returns; for STRENGTH, returns flatten much earlier. Very high volumes raise the recovery/injury/time cost without proportional benefit and can become counterproductive if recovery isn't met.",
      "numbers": {
        "hypertrophyDiminishingReturnsAbove": 20,
        "strengthPlateausEarlierThanHypertrophy": true
      },
      "evidence": "moderate",
      "why": "There is a point where adding sets just adds fatigue and time, not muscle — if you're already doing 20+ sets for a muscle and stalling, the fix is usually better recovery or effort, not more volume.",
      "individualNote": "The true upper limit is unclear and study heterogeneity is high. Whether YOU benefit from very high volume depends on recovery capacity; watch for stalled lifts, poor sleep, and joint aches as signs you've overshot.",
      "refs": [
        "Pelland et al. (2025) - RT Dose Response meta-regressions / Sports Medicine",
        "Baz-Valle et al. (2022) - Systematic review of RT volume on hypertrophy / Int J Environ Res Public Health"
      ]
    },
    {
      "id": "frequency-2x-per-week",
      "topic": "frequency",
      "recommendation": "When weekly VOLUME is equated, training a muscle 2x/week vs 1x/week produces similar hypertrophy — frequency is mainly a tool to distribute volume. Practical recommendation: hit each muscle ~2x/week so higher weekly set counts are spread into quality sessions rather than one exhausting one.",
      "numbers": {
        "recommendedFrequencyPerMuscleWeek": [
          2,
          3
        ],
        "hypertrophyDifferenceWhenVolumeEqual": "negligible"
      },
      "evidence": "strong",
      "why": "Twice a week isn't magic for growth itself — it just lets you do your sets fresher across the week instead of grinding them all in one beat-up session.",
      "individualNote": "Higher frequency helps most when weekly volume is high (too many sets in one session degrades quality). If you train a muscle only 1x/week and volume is high, splitting it may improve performance per set.",
      "refs": [
        "Schoenfeld, Ogborn & Krieger (2016) - RT frequency meta-analysis / Sports Medicine",
        "Pelland et al. (2025) - RT Dose Response meta-regressions / Sports Medicine"
      ]
    },
    {
      "id": "frequency-strength-split",
      "topic": "frequency",
      "recommendation": "For strength, higher frequency (2-3x/week per lift/pattern) tends to edge out lower frequency, partly via skill/practice, though with diminishing returns. Choose the split (full-body, upper/lower, PPL) that lets each muscle be trained ~2x/week at the target volume.",
      "numbers": {
        "strengthFrequencyPerPatternWeek": [
          2,
          3
        ],
        "splitIsVolumeDistributionTool": true
      },
      "evidence": "moderate",
      "why": "Strength is a skill — practicing the big lifts a couple times a week beats cramming, but the gap is small once volume is matched, so pick the split you'll actually stick to.",
      "individualNote": "Schedule and recovery drive split choice more than any inherent superiority. If a lift feels rusty rather than weak, more frequent lighter practice may help you more than more volume.",
      "refs": [
        "Currier et al. (2023) - RT prescription Bayesian network meta-analysis / Br J Sports Med",
        "Pelland et al. (2025) - RT Dose Response meta-regressions / Sports Medicine"
      ]
    },
    {
      "id": "effort-rir-hypertrophy",
      "topic": "intensity",
      "recommendation": "For hypertrophy, train most sets with about 0-3 reps in reserve (RIR). Going all the way to failure gives only a trivial extra hypertrophy benefit and adds meaningful fatigue, so reserve failure for occasional sets (often isolation/machine work).",
      "numbers": {
        "hypertrophyRIR": [
          0,
          3
        ],
        "failureVsNonFailureHypertrophyEffectSize": 0.19,
        "failureAdvantage": "trivial"
      },
      "evidence": "strong",
      "why": "You have to take sets close to failure to grow, but grinding every set to total failure buys you almost nothing extra while wrecking your recovery — leave a rep or two in the tank most of the time.",
      "individualNote": "RIR estimation is a trainable skill and beginners tend to overestimate how many reps they have left. If your sets aren't near failure your growth may lag; velocity or rep-quality cues can calibrate this.",
      "refs": [
        "Refalo et al. (2023) - Proximity-to-failure & hypertrophy meta-analysis / Sports Medicine",
        "Refalo et al. (2024) - Dose-response proximity-to-failure, strength & hypertrophy / Sports Medicine"
      ]
    },
    {
      "id": "effort-rir-strength",
      "topic": "intensity",
      "recommendation": "For strength, effort proximity matters less than load and quality; keep more reps in reserve (~1-4 RIR) on heavy compounds to preserve bar speed, technique, and next-session performance. Failure is not required and adds disproportionate fatigue on big lifts.",
      "numbers": {
        "strengthRIR": [
          1,
          4
        ],
        "failureRequiredForStrength": false
      },
      "evidence": "moderate",
      "why": "Getting strong is about moving heavy weight well and often — repeatedly missing or grinding reps just makes you tired for the sessions that actually build strength.",
      "individualNote": "Strength is more sensitive to accumulated fatigue than hypertrophy; if your top sets slow down week to week, back off effort/volume before load.",
      "refs": [
        "Refalo et al. (2024) - Dose-response proximity-to-failure / Sports Medicine",
        "Davies et al. (2016) - Failure vs non-failure & strength meta-analysis / Sports Medicine"
      ]
    },
    {
      "id": "intensity-rep-range-hypertrophy",
      "topic": "intensity",
      "recommendation": "For hypertrophy, load is flexible: anywhere from ~5 to ~30 reps builds similar muscle IF sets are taken close to failure. Use a practical ~6-15 rep range for most work to balance stimulus with joint stress and fatigue.",
      "numbers": {
        "hypertrophyRepRange": [
          5,
          30
        ],
        "practicalRepRange": [
          6,
          15
        ],
        "loadThresholdEquivalence": "≤60% vs >60% 1RM equal when near failure"
      },
      "evidence": "strong",
      "why": "Light or heavy, high reps or low, the muscle grows about the same as long as you push each set close to failure — so pick loads your joints and schedule tolerate.",
      "individualNote": "Very high-rep sets are more uncomfortable and effort-dependent; very heavy low-rep sets tax joints and CNS. Personal preference and joint health should steer where in the range you live.",
      "refs": [
        "Schoenfeld, Grgic, Ogborn & Krieger (2017) - Low- vs high-load meta-analysis / J Strength Cond Res",
        "Currier et al. (2023) - RT prescription network meta-analysis / Br J Sports Med"
      ]
    },
    {
      "id": "intensity-load-strength",
      "topic": "intensity",
      "recommendation": "Maximal strength is load-specific: to maximize 1RM strength, include heavy work above ~80% 1RM (roughly ≤6 reps), with multiple sets and ~2-3x/week frequency. Lighter loads build muscle but are inferior for peak strength.",
      "numbers": {
        "strengthLoadPct1RM": ">80",
        "strengthRepRange": [
          1,
          6
        ],
        "higherLoadMaximizesStrength": true
      },
      "evidence": "strong",
      "why": "If your goal is a bigger max, you have to practice with near-max weights — light-and-fluffy training grows muscle but won't make you as strong.",
      "individualNote": "Heavy loading demands good technique and recovery; new lifters get strong on moderate loads first and should earn heavy singles/doubles over time.",
      "refs": [
        "Currier et al. (2023) - RT prescription network meta-analysis / Br J Sports Med",
        "Schoenfeld, Grgic, Ogborn & Krieger (2017) - Low- vs high-load meta-analysis / J Strength Cond Res"
      ]
    },
    {
      "id": "intensity-endurance-reps",
      "topic": "intensity",
      "recommendation": "For local muscular endurance, higher reps with lighter loads (~15-30+ reps, <60% 1RM) are most specific. This range also builds muscle if near failure but is suboptimal for max strength.",
      "numbers": {
        "enduranceRepRange": [
          15,
          40
        ],
        "enduranceLoadPct1RM": "<60"
      },
      "evidence": "moderate",
      "why": "Training to handle many reps makes you better at many reps — great for endurance goals, fine for size, but not the fast lane to a big one-rep max.",
      "individualNote": "Endurance adaptations are fairly specific to the rep range trained; match the range to the demand you care about.",
      "refs": [
        "Schoenfeld et al. (2021) - Loading recommendations for hypertrophy/strength/endurance / review",
        "Schoenfeld, Grgic, Ogborn & Krieger (2017) - Low- vs high-load meta-analysis / J Strength Cond Res"
      ]
    },
    {
      "id": "progression-linear-novice",
      "topic": "progression",
      "recommendation": "Novices should use simple linear progression: add a small amount of load (or reps) session to session or week to week while keeping reps in a set range. This works because untrained lifters adapt fast and can add weight almost every session for months.",
      "numbers": {
        "noviceProgressionCadence": "every session to weekly",
        "typicalUpperBodyIncrementKg": [
          1,
          2.5
        ],
        "typicalLowerBodyIncrementKg": [
          2.5,
          5
        ]
      },
      "evidence": "strong",
      "why": "When you're new, your body improves so quickly that you can add a little weight almost every workout — keep it simple and just add.",
      "individualNote": "How long linear progression lasts varies (weeks to many months); when you stall on a lift twice despite good sleep/food, it's time to switch to slower progression schemes.",
      "refs": [
        "Currier et al. (2023) - RT prescription network meta-analysis / Br J Sports Med",
        "American College of Sports Medicine (2009) - Progression models in resistance training position stand / Med Sci Sports Exerc"
      ]
    },
    {
      "id": "progression-double-progression",
      "topic": "progression",
      "recommendation": "For intermediates, use double progression: work within a rep range (e.g., 8-12), add reps until you hit the top of the range across all sets, then increase load and drop back to the bottom of the range. Repeat.",
      "numbers": {
        "exampleRepRange": [
          8,
          12
        ],
        "method": "add reps first, then load"
      },
      "evidence": "practice-based",
      "why": "Once weight won't go up every week, you make progress by squeezing out more reps first, then bumping the weight once you own the top of the range.",
      "individualNote": "This is a robust, low-risk default; the specific rep range is a preference. Track reps-at-load so you can see progress even in weeks the weight doesn't move.",
      "refs": [
        "American College of Sports Medicine (2009) - Progression models position stand / Med Sci Sports Exerc"
      ]
    },
    {
      "id": "progression-periodization-undulating",
      "topic": "progression",
      "recommendation": "Some form of periodization modestly beats non-periodized training for strength, but daily undulating (DUP) and linear (LP) models produce similar hypertrophy and similar-to-slightly-better strength — the specific model matters less than progressive overload and adherence.",
      "numbers": {
        "DUPvsLP_hypertrophy_SMD": 0.02,
        "periodizedBeatsNonPeriodized": "small for strength"
      },
      "evidence": "moderate",
      "why": "Varying your reps and loads across the week (or block) is a fine way to organize training, but no single scheme is clearly best — consistency and steadily adding work is what actually moves the needle.",
      "individualNote": "Model choice is largely preference/adherence. Undulating styles can keep training more engaging for some; pick what you'll follow consistently.",
      "refs": [
        "Grgic et al. (2017) - Linear vs daily undulating periodization & hypertrophy meta-analysis / PeerJ",
        "Williams et al. (2017) - Periodized vs non-periodized RT & strength meta-analysis / Sports Medicine"
      ]
    },
    {
      "id": "progression-deload",
      "topic": "progression",
      "recommendation": "Deloads (~1 week of reduced volume and/or load/effort) are a widely used fatigue-management tool, typically deployed every ~4-8 weeks or triggered by fatigue signs. Evidence is mostly practice/consensus-based rather than strongly proven to boost gains; true overtraining from lifting alone is uncommon over normal timeframes.",
      "numbers": {
        "deloadDurationWeeks": 1,
        "typicalCadenceWeeks": [
          4,
          8
        ],
        "typicalVolumeOrLoadReduction": "~40-60%"
      },
      "evidence": "practice-based",
      "why": "Planned easy weeks are insurance against accumulated fatigue and nagging aches — not a magic growth trick, but a smart way to keep training hard sustainably.",
      "individualNote": "Flexible, autoregulated deloads (taken when performance/sleep/motivation dip or joints ache) are favored by many coaches over rigid schedules. Trigger signs: stalled or dropping lifts, poor sleep, persistent soreness, low motivation.",
      "refs": [
        "Bell et al. (2022) - Coaches' perceptions & practices of deloading / Front Sports Act Living",
        "Coleman et al. (2024) - One-week deload during supervised RT & adaptations / PeerJ"
      ]
    },
    {
      "id": "exercise-lengthened-position",
      "topic": "exercise-selection",
      "recommendation": "Training a muscle emphasizing its lengthened (stretched) position drives disproportionate hypertrophy. Prefer exercises that load the muscle when it's long (e.g., overhead triceps extensions, deep-stretch leg work) and use a full or lengthened-biased range of motion rather than short/top-range partials.",
      "numbers": {
        "lengthenedBiasBeatsShortened": true,
        "lengthenedPartialsVsFullROM": "equal or greater hypertrophy",
        "shortenedPartials": "inferior"
      },
      "evidence": "moderate",
      "why": "The bottom, stretched part of a rep is where most of the muscle-building happens — so pick exercises that make the muscle work hard while it's long.",
      "individualNote": "This is an emerging, fast-moving area; magnitudes vary by muscle and study. Full ROM remains a safe default; lengthened-biased selection is an optimization, not a requirement.",
      "refs": [
        "Pedrosa et al. (2022) - Long-length partials & quad hypertrophy / Eur J Sport Sci",
        "Maeo et al. (2023) - Overhead vs neutral triceps extension hypertrophy / Eur J Sport Sci",
        "Kassiano et al. (2023) - ROM & regional hypertrophy review / J Strength Cond Res"
      ]
    },
    {
      "id": "exercise-compound-vs-isolation",
      "topic": "exercise-selection",
      "recommendation": "Compound lifts are efficient, build strength across multiple muscles, and should anchor a program; isolation work targets muscles that big lifts under-stimulate (e.g., biceps, side delts, hamstrings via curls, calves) and adds volume with low systemic fatigue. Use both.",
      "numbers": {
        "compoundRole": "primary strength & multi-muscle stimulus",
        "isolationRole": "targeted volume, low fatigue"
      },
      "evidence": "moderate",
      "why": "Big lifts give you the most bang per exercise; isolation moves let you hammer the muscles that the big lifts leave behind without draining you.",
      "individualNote": "Weak points and proportions differ per person; add isolation for muscles that lag or that your main lifts don't fatigue well.",
      "refs": [
        "Currier et al. (2023) - RT prescription network meta-analysis / Br J Sports Med",
        "Gentil et al. (2017) - Single- vs multi-joint exercise for hypertrophy / review"
      ]
    },
    {
      "id": "exercise-stimulus-to-fatigue",
      "topic": "exercise-selection",
      "recommendation": "Prefer exercises with a high stimulus-to-fatigue ratio (SFR): strong target-muscle tension with relatively low systemic/joint fatigue and injury risk. Machines and stable isolation moves often have high SFR for pure hypertrophy; maximal deadlifts have high fatigue cost for their hypertrophy stimulus.",
      "numbers": {
        "prioritize": "high stimulus, low fatigue/injury cost"
      },
      "evidence": "practice-based",
      "why": "Some exercises give you a lot of muscle stimulus for very little wear-and-tear — favor those, especially late in a session when you're already tired.",
      "individualNote": "SFR is individual: an exercise that trashes one person's lower back or knees may feel great for another. Swap exercises that cause joint pain for equivalents that don't.",
      "refs": [
        "Pelland et al. (2025) - RT Dose Response meta-regressions (direct vs indirect sets) / Sports Medicine"
      ]
    },
    {
      "id": "recovery-sleep-hypertrophy-strength",
      "topic": "recovery",
      "recommendation": "Sleep ~7-9 hours (athletes/hard trainers often benefit from 8-10). Chronic short sleep (<6h) impairs strength expression, reduces productive reps per session, and shifts hormonal/recovery environment unfavorably; sleep extension has improved athletic performance measures.",
      "numbers": {
        "generalHoursPerNight": [
          7,
          9
        ],
        "hardTrainerTarget": [
          8,
          10
        ],
        "impairmentThreshold": "<6h",
        "sleepExtensionImprovesPerformance": true
      },
      "evidence": "moderate",
      "why": "Skimping on sleep quietly cuts how much good work you can do in the gym and how well you recover — it's the cheapest performance upgrade you have.",
      "individualNote": "Acute one-off short nights mostly hurt endurance/late-session output more than a single heavy top set. Track sleep vs. session quality; if lifts sag after poor sleep, that's your signal.",
      "refs": [
        "Craven et al. (2022) - Acute sleep loss & physical performance meta-analysis / Sports Medicine",
        "Mah et al. (2011) - Sleep extension & basketball performance / Sleep"
      ]
    },
    {
      "id": "recovery-rest-intervals-strength",
      "topic": "recovery",
      "recommendation": "For strength, and for compound multi-joint lifts generally, rest ~2-3 minutes (or more) between sets to preserve force output and next-set quality. Short rests (<1 min) compromise strength work.",
      "numbers": {
        "strengthRestMinutes": [
          2,
          3
        ],
        "compoundRestMinutes": [
          2,
          3
        ],
        "isolationRestMinutes": [
          1,
          2
        ]
      },
      "evidence": "strong",
      "why": "Heavy and big lifts need real rest — rushing back in under a minute just means fewer quality reps and a weaker session.",
      "individualNote": "Bigger muscles/compound patterns need longer rest; small isolation moves recover faster. Rest by feel: resume when breathing and the target muscle feel ready, not by a rigid clock.",
      "refs": [
        "Grgic et al. (2018) - Rest interval duration & muscular strength systematic review / Sports Medicine",
        "Schoenfeld et al. (2016) - Longer inter-set rest & strength/hypertrophy in trained men / J Strength Cond Res"
      ]
    },
    {
      "id": "recovery-rest-intervals-hypertrophy",
      "topic": "recovery",
      "recommendation": "For hypertrophy in trained lifters, resting ≥2 minutes tends to beat very short (<60s) rests, mainly by allowing more volume-load at quality. Short rests are viable in novices and for time-efficiency but shouldn't force premature set failure that cuts reps.",
      "numbers": {
        "hypertrophyRestMinutes": [
          1.5,
          3
        ],
        "shortRestPenaltyInTrained": true
      },
      "evidence": "moderate",
      "why": "Even for pure size, resting long enough to keep your reps up beats gasping between sets — the extra reps you keep are what grow the muscle.",
      "individualNote": "If time-limited, supersetting non-competing muscles preserves total work. Watch whether short rests are cutting your reps; if so, rest longer.",
      "refs": [
        "Give it a rest (2024) - Bayesian meta-analysis, inter-set rest & hypertrophy / Front Sports Act Living",
        "Schoenfeld et al. (2016) - Longer inter-set rest in trained men / J Strength Cond Res"
      ]
    },
    {
      "id": "recovery-overreaching-signs",
      "topic": "recovery",
      "recommendation": "Non-functional overreaching/overtraining from lifting alone is uncommon short-term, but watch for a cluster of warning signs: multi-session performance decline, unshakable fatigue, disrupted sleep, elevated resting HR, low motivation/mood, and persistent joint aches. Respond with a deload or reduced volume.",
      "numbers": {
        "keySigns": [
          "performance drop across sessions",
          "poor sleep",
          "low motivation",
          "persistent soreness/aches",
          "elevated resting HR"
        ],
        "response": "deload / reduce volume"
      },
      "evidence": "practice-based",
      "why": "One bad session is noise; a stretch of getting weaker while feeling wrecked and unmotivated is your body asking for a lighter week.",
      "individualNote": "Life stress, under-eating, and poor sleep amplify training fatigue. Simple trackers (session performance, sleep, resting HR, mood) catch this earlier than feel alone.",
      "refs": [
        "Bell et al. (2022) - Deloading perceptions & practices / Front Sports Act Living",
        "Grandou et al. (2020) - Overtraining in resistance exercise narrative review / Sports Medicine"
      ]
    },
    {
      "id": "nutrition-protein-gain",
      "topic": "nutrition",
      "recommendation": "To maximize muscle gain, eat ~1.6 g protein per kg bodyweight per day; benefits plateau around there, with an upper bound near ~2.2 g/kg for insurance. Total daily protein is what matters most.",
      "numbers": {
        "proteinGkgGain": [
          1.6,
          2.2
        ],
        "meanBreakpointGkg": 1.62
      },
      "evidence": "strong",
      "why": "About 1.6 grams of protein per kilo of bodyweight covers muscle-building for nearly everyone — more than roughly 2.2 doesn't add muscle, it just costs money.",
      "individualNote": "Older lifters and those in a deficit or very lean/heavily trained skew higher. Simplest personal check: hit the target consistently for a month and watch strength and scale trends.",
      "refs": [
        "Morton et al. (2018) - Protein supplementation & RT gains meta-analysis / Br J Sports Med"
      ]
    },
    {
      "id": "nutrition-protein-deficit",
      "topic": "nutrition",
      "recommendation": "In an energy deficit, raise protein to preserve muscle: ~1.8-2.7 g/kg bodyweight per day (equivalently ~2.3-3.1 g/kg of fat-free mass), scaling higher the leaner and/or more aggressive the cut.",
      "numbers": {
        "proteinGkgBWDeficit": [
          1.8,
          2.7
        ],
        "proteinGkgFFMDeficit": [
          2.3,
          3.1
        ]
      },
      "evidence": "moderate",
      "why": "When you're eating less to lose fat, more protein is your muscle's seatbelt — it keeps the weight you lose coming from fat, not hard-earned muscle.",
      "individualNote": "The leaner you are and the steeper the deficit, the higher you push within the range. In one trial 2.3 g/kg lost far less lean mass than 1 g/kg at the same fat loss.",
      "refs": [
        "Helms et al. (2014) - Dietary protein during caloric restriction in lean athletes / Int J Sport Nutr Exerc Metab",
        "Morton et al. (2018) - Protein & RT gains meta-analysis / Br J Sports Med"
      ]
    },
    {
      "id": "nutrition-surplus-rate-of-gain",
      "topic": "nutrition",
      "recommendation": "For lean gaining, run a modest surplus (~+200-400 kcal/day) targeting ~0.25-0.5% bodyweight gain per week. Faster gaining does not add more muscle — it just adds more fat that must later be cut.",
      "numbers": {
        "surplusKcalPerDay": [
          200,
          400
        ],
        "weeklyGainPctBW": [
          0.25,
          0.5
        ],
        "garthe0.5pctWeek": "~60-65% of gain as fat-free mass"
      },
      "evidence": "moderate",
      "why": "Muscle only builds so fast — eat a little over maintenance so the scale creeps up slowly, and most of what you add is muscle, not belly.",
      "individualNote": "Novices and returning lifters can gain muscle faster (and tolerate a slightly larger surplus); advanced lifters should gain slower. Adjust calories off the actual weekly weight trend.",
      "refs": [
        "Garthe et al. (2013) - Nutritional intervention, body composition & performance in athletes / Int J Sport Nutr Exerc Metab",
        "Slater et al. (2019) - Is an energy surplus required to maximize hypertrophy? / Front Nutr"
      ]
    },
    {
      "id": "nutrition-deficit-rate-of-loss",
      "topic": "nutrition",
      "recommendation": "For fat loss with muscle retention, aim to lose ~0.5-1.0% of bodyweight per week (roughly a ~300-700 kcal/day deficit for many). Slower loss (~0.5-0.7%/week) better preserves lean mass and strength than aggressive cuts.",
      "numbers": {
        "weeklyLossPctBW": [
          0.5,
          1.0
        ],
        "leanRetentionSweetSpot": [
          0.5,
          0.7
        ],
        "typicalDeficitKcal": [
          300,
          700
        ]
      },
      "evidence": "moderate",
      "why": "Losing weight slowly and steadily lets you keep your muscle and strength — crash dieting mostly just makes you a smaller, weaker version of yourself.",
      "individualNote": "Leaner individuals should lean toward the slow end to protect muscle; those with more fat to lose can tolerate the faster end. Set the deficit off measured weekly trend, not a calculator guess.",
      "refs": [
        "Garthe et al. (2011) - Two weight-loss rates & body composition/performance in athletes / Int J Sport Nutr Exerc Metab",
        "Helms et al. (2014) - Protein during caloric restriction / Int J Sport Nutr Exerc Metab"
      ]
    },
    {
      "id": "nutrition-timing-distribution",
      "topic": "nutrition",
      "recommendation": "Total daily protein and calories dominate; nutrient timing is a minor optimization. Practically: spread protein across ~3-5 meals at ~0.4 g/kg each, and include protein within a few hours around training. The 'anabolic window' is wide, not 30 minutes.",
      "numbers": {
        "mealsPerDay": [
          3,
          5
        ],
        "proteinPerMealGkg": [
          0.4,
          0.55
        ],
        "leucineThresholdG": [
          2.5,
          3
        ],
        "anabolicWindowHours": "several"
      },
      "evidence": "moderate",
      "why": "Hitting your daily protein and calorie targets is 95% of the game — spreading protein across the day is a small bonus, and you don't need to sprint to a shaker after your last set.",
      "individualNote": "Timing matters slightly more if you train fasted or go long stretches without protein. If total intake is on point, don't stress the clock.",
      "refs": [
        "Schoenfeld & Aragon (2018) - How much protein per meal / J Int Soc Sports Nutr",
        "Morton et al. (2018) - Protein & RT gains meta-analysis / Br J Sports Med"
      ]
    },
    {
      "id": "cardio-interference-effect",
      "topic": "cardio-concurrent",
      "recommendation": "The interference effect on maximal STRENGTH and whole-muscle HYPERTROPHY is small-to-negligible in most trainees; concurrent aerobic + strength training does not meaningfully blunt size or max strength. Explosive/power qualities (jump, sprint) are more affected, and there may be a small negative at the muscle-fiber level.",
      "numbers": {
        "strengthHypertrophyInterference": "small/negligible",
        "explosivePowerReduction": "~28% when combined, esp. same session",
        "fiberLevel": "small negative possible"
      },
      "evidence": "moderate",
      "why": "For building muscle and getting strong, cardio won't 'kill your gains' — the only real casualty is explosive power like jumping and sprinting, especially if you do both hard in one session.",
      "individualNote": "Interference grows with high aerobic volume/frequency and same-session pairing. If power is your goal, separate cardio and lifting; for general muscle/fat goals, don't worry much.",
      "refs": [
        "Schumann et al. (2022) - Concurrent strength & endurance training meta-analysis / Sports Medicine",
        "Lundberg et al. (2022) - Concurrent training & muscle fiber hypertrophy meta-analysis / Sports Medicine"
      ]
    },
    {
      "id": "cardio-programming-moderators",
      "topic": "cardio-concurrent",
      "recommendation": "Minimize interference by: separating cardio and lifting by several hours or on different days; lifting before cardio when combined; favoring cycling over running for less muscle damage in the legs; and keeping aerobic volume/intensity in check. These are the main moderators of interference.",
      "numbers": {
        "separationHours": ">=3 preferred (or different days)",
        "orderWhenCombined": "lift first if strength/size prioritized",
        "modalityNote": "cycling < running for leg interference"
      },
      "evidence": "moderate",
      "why": "A little planning erases most cardio-lifting conflict — space them out, lift first, and pick low-impact cardio when your legs are the priority.",
      "individualNote": "Interference is dose-dependent; recreational cardio amounts rarely matter. Endurance-heavy athletes need the most careful scheduling.",
      "refs": [
        "Schumann et al. (2022) - Concurrent training meta-analysis / Sports Medicine",
        "Eddens et al. (2018) - Effect of intra-session exercise sequence, interference meta-analysis / Sports Medicine"
      ]
    },
    {
      "id": "cardio-goal-context",
      "topic": "cardio-concurrent",
      "recommendation": "For MUSCLE-GAIN goals, cap cardio to what supports health/recovery and keep it low-impact and separated from lifting so it doesn't eat into recovery or appetite. For FAT-LOSS goals, cardio is a useful tool to widen the deficit, but diet drives most fat loss and resistance training + high protein preserve muscle.",
      "numbers": {
        "muscleGain": "minimal, separated, low-impact cardio",
        "fatLoss": "cardio widens deficit; diet primary; keep lifting to retain muscle"
      },
      "evidence": "moderate",
      "why": "When bulking, keep cardio light so it doesn't steal recovery; when cutting, cardio helps burn a bit more, but your fork and your lifting are what protect your muscle.",
      "individualNote": "Very high cardio during a hard bulk can offset the surplus and blunt gains. During a cut, don't let cardio replace lifting — lifting is what tells the body to keep the muscle.",
      "refs": [
        "Schumann et al. (2022) - Concurrent training meta-analysis / Sports Medicine",
        "Helms et al. (2014) - Protein during caloric restriction / Int J Sport Nutr Exerc Metab"
      ]
    },
    {
      "id": "safety-injury-red-flags",
      "topic": "safety",
      "recommendation": "Refer the user to a medical/qualified professional (do not self-coach through) if they report: sharp/stabbing pain pinpointed to one spot, joint pain that persists or worsens, numbness/tingling/weakness, night pain that wakes them, visible deformity/rapid swelling, inability to bear weight, or pain lasting >1-2 weeks or recurring. Emergency signs (deformity, loss of sensation after trauma, cannot move a limb) warrant urgent care.",
      "numbers": {
        "seeProfessionalIf": [
          "sharp pinpoint pain",
          "joint pain persistent/worsening",
          "numbness/tingling/weakness",
          "night pain waking them",
          "swelling or can't bear weight",
          "pain >1-2 weeks or recurring"
        ],
        "emergency": [
          "deformity",
          "loss of sensation after trauma",
          "cannot move limb"
        ]
      },
      "evidence": "practice-based",
      "why": "Normal training soreness is dull, spread out, and fades — sharp, pinpoint, joint, or nerve-type pain is a stop sign that needs a professional, not a heavier warmup.",
      "individualNote": "An AI coach must not diagnose or rehab injuries. Distinguish generalized muscle soreness (normal) from localized/joint/neurological symptoms (refer out).",
      "refs": [
        "Cleveland Clinic - Joint pain: when to see a doctor / clinical guidance",
        "Mass General Brigham - When to seek treatment for workout pain / clinical guidance"
      ]
    },
    {
      "id": "safety-calorie-floor",
      "topic": "safety",
      "recommendation": "Do not program calories below sane floors: keep intake at/above roughly BMR (commonly cited practical floors ~1200 kcal/day for women, ~1500 kcal/day for men as a hard minimum), and never below resting energy needs for extended periods. Deep, prolonged deficits risk muscle loss, hormonal/menstrual disruption, poor recovery, and disordered patterns.",
      "numbers": {
        "practicalFloorWomenKcal": 1200,
        "practicalFloorMenKcal": 1500,
        "principle": "stay >= BMR for sustained periods",
        "preferModerateDeficit": [
          300,
          700
        ]
      },
      "evidence": "practice-based",
      "why": "Cutting calories to nothing backfires — you lose muscle, wreck recovery and hormones, and can't sustain it; a moderate deficit gets you leaner and keeps you healthy.",
      "individualNote": "Body size changes the floor (a large athlete's floor is higher). Rely on rate-of-loss and energy/mood/sleep/performance markers, not just a number; refer out if under-eating patterns appear.",
      "refs": [
        "Fagerberg (2018) - Physiological adaptations to low-energy-availability bodybuilding prep / Int J Sport Nutr Exerc Metab",
        "Mountjoy et al. (2018) - IOC consensus on Relative Energy Deficiency in Sport (RED-S) / Br J Sports Med"
      ]
    },
    {
      "id": "safety-max-rates",
      "topic": "safety",
      "recommendation": "Cap prescribed rates: weight LOSS at ~1% bodyweight per week (rarely faster, and only short-term for those with high body fat), and weight GAIN at ~0.5% bodyweight per week for trained lifters. Faster than these costs muscle (cutting) or adds needless fat (bulking) without more muscle.",
      "numbers": {
        "maxWeeklyLossPctBW": 1.0,
        "maxLeanWeeklyGainPctBW": 0.5,
        "faster": "no added muscle / more muscle loss"
      },
      "evidence": "moderate",
      "why": "There's a speed limit on changing your body composition — push past ~1%/week down or ~0.5%/week up and you're just trading muscle for speed or gaining fat you'll have to lose later.",
      "individualNote": "Higher-body-fat individuals can safely lose a bit faster short-term; novices can gain slightly faster. Always steer by the measured weekly trend, not wishful targets.",
      "refs": [
        "Garthe et al. (2011) - Two weight-loss rates in athletes / Int J Sport Nutr Exerc Metab",
        "Garthe et al. (2013) - Nutritional intervention & body composition / Int J Sport Nutr Exerc Metab"
      ]
    },
    {
      "id": "individual-response-variability",
      "topic": "volume",
      "recommendation": "Response to any fixed program varies substantially between people (genetics, recovery, adherence, measurement noise). Treat published ranges as starting points and autoregulate: adjust volume, effort, and calories based on the individual's own tracked strength, measurements, and recovery over 8-12 week blocks.",
      "numbers": {
        "approach": "start from evidence-based range, then individualize on tracked data",
        "reviewWindowWeeks": [
          8,
          12
        ]
      },
      "evidence": "strong",
      "why": "The research gives us a great starting point, but your body has the final say — we set a sensible plan, then let your actual progress tell us what to tweak.",
      "individualNote": "So-called 'non-responders' to a given dose often respond when volume or effort is adjusted. The user's logged lifts, body measurements, sleep, and adherence are the data that resolve what's optimal for them.",
      "refs": [
        "Higher RT volume offsets hypertrophy nonresponsiveness (2024) / J Appl Physiol",
        "Pelland et al. (2025) - RT Dose Response meta-regressions / Sports Medicine"
      ]
    }
  ]
};
;

  var byId = {};
  DATA.entries.forEach(function (e) { byId[e.id] = e; });

  function get(id) { return byId[id] || null; }
  function all() { return DATA.entries; }
  function forTopic(t) {
    return DATA.entries.filter(function (e) { return e.topic === t; });
  }

  /* ---------- programming parameters (single source of truth) ---------- */

  /** Weekly hard-set range per muscle group for a training level. */
  function volumeRange(level) {
    var n = get("volume-hypertrophy-range").numbers.setsPerMuscleWeek;
    return n[level === "beginner" ? "novice" : level === "advanced" ? "advanced" : "intermediate"].slice();
  }

  /** [MEV, MRV]-style band the learning loop must stay inside. */
  function volumeBand(level) {
    var r = volumeRange(level);
    var floor = get("volume-minimum-effective").numbers.minEffectiveSetsPerMuscleWeek;
    return [Math.max(floor, r[0] - 2), r[1]];
  }

  /** Starting weekly sets: lower-middle of the range (start moderate,
      adjust from the user's own response — and say so). */
  function volumeStart(level) {
    var r = volumeRange(level);
    return Math.round(r[0] + (r[1] - r[0]) * 0.35);
  }

  /** Target per-muscle frequency (sessions/week). */
  function frequencyTarget() {
    return get("frequency-2x-per-week").numbers.recommendedFrequencyPerMuscleWeek.slice();
  }

  /** RIR band for a goal kind ("hypertrophy" | "strength"). */
  function rirBand(kind) {
    return kind === "strength"
      ? get("effort-rir-strength").numbers.strengthRIR.slice()
      : get("effort-rir-hypertrophy").numbers.hypertrophyRIR.slice();
  }

  /** Practical rep range for a goal kind. */
  function repRange(kind) {
    if (kind === "strength") return get("intensity-load-strength").numbers.strengthRepRange.slice();
    if (kind === "endurance") return get("intensity-endurance-reps").numbers.enduranceRepRange.slice();
    return get("intensity-rep-range-hypertrophy").numbers.practicalRepRange.slice();
  }

  /** Rest minutes [lo, hi] for compound vs isolation work. */
  function restMinutes(compound) {
    var r = get("recovery-rest-intervals-strength").numbers;
    return (compound ? r.compoundRestMinutes : r.isolationRestMinutes).slice();
  }

  /** Protein g/kg band. mode "gain" | "deficit". */
  function proteinBand(mode) {
    return mode === "deficit"
      ? get("nutrition-protein-deficit").numbers.proteinGkgBWDeficit.slice()
      : get("nutrition-protein-gain").numbers.proteinGkgGain.slice();
  }

  /* ---------- safety layer ---------- */
  function safety() {
    var flags = get("safety-injury-red-flags").numbers;
    var floor = get("safety-calorie-floor").numbers;
    var rates = get("safety-max-rates").numbers;
    return {
      seeProfessionalIf: flags.seeProfessionalIf.slice(),
      emergency: flags.emergency.slice(),
      calorieFloor: { women: floor.practicalFloorWomenKcal, men: floor.practicalFloorMenKcal },
      maxWeeklyLossPctBW: rates.maxWeeklyLossPctBW,
      maxWeeklyGainPctBW: rates.maxLeanWeeklyGainPctBW,
      referOutCopy: "That kind of pain is outside what a training plan should coach through - " +
        "please have it looked at by a physio or doctor before we load it. I can work around " +
        "it in the meantime."
    };
  }

  /* ---------- "why?" surfaces ---------- */

  /** Short client-facing why for an entry id ("" if unknown). */
  function why(id) {
    var e = get(id);
    return e ? e.why : "";
  }

  /** why + honesty qualifier when the evidence is mixed/practice-based. */
  function whyHonest(id) {
    var e = get(id);
    if (!e) return "";
    var tag = e.evidence === "mixed" ? " (the research is genuinely mixed here - we\u2019ll let your own data decide)"
      : e.evidence === "practice-based" ? " (this one is coaching practice more than hard trial data)"
      : "";
    return e.why + tag;
  }

  /* ---------- compact block for the LLM (~1 KB) ----------
     Only ids + one-line claims + evidence grade; the model cites these
     instead of inventing science. Callers may pass the ids most relevant
     to the current program; default = the core set. */
  var CORE_IDS = [
    "volume-hypertrophy-range", "frequency-2x-per-week", "effort-rir-hypertrophy",
    "intensity-rep-range-hypertrophy", "progression-double-progression",
    "progression-deload", "exercise-lengthened-position",
    "recovery-sleep-hypertrophy-strength", "recovery-rest-intervals-strength",
    "nutrition-protein-gain", "nutrition-deficit-rate-of-loss",
    "individual-response-variability"
  ];
  function coachContext(ids) {
    var list = (Array.isArray(ids) && ids.length ? ids : CORE_IDS);
    var out = [];
    list.forEach(function (id) {
      var e = get(id);
      if (!e) return;
      out.push({
        id: e.id,
        claim: e.recommendation.length > 110 ? e.recommendation.slice(0, 107) + "..." : e.recommendation,
        evidence: e.evidence
      });
    });
    return { kbVersion: DATA.version, entries: out };
  }

  return {
    version: DATA.version,
    get: get,
    all: all,
    forTopic: forTopic,
    volumeRange: volumeRange,
    volumeBand: volumeBand,
    volumeStart: volumeStart,
    frequencyTarget: frequencyTarget,
    rirBand: rirBand,
    repRange: repRange,
    restMinutes: restMinutes,
    proteinBand: proteinBand,
    safety: safety,
    why: why,
    whyHonest: whyHonest,
    coachContext: coachContext
  };
})();
