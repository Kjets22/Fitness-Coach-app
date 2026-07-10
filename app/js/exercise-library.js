/* ============================================================
   exercise-library.js — a built-in catalog of common exercises,
   grouped by muscle. Seeds the "add exercise" autocomplete so it's
   useful on day one; the workout tracker merges these with the
   distinct names the user has actually logged before.
   Pure data + tiny helpers, no state.
   ============================================================ */

window.OF = window.OF || {};

OF.exerciseLibrary = (function () {
  "use strict";

  var GROUPS = {
    "Chest": [
      "Bench Press", "Incline Bench Press", "Decline Bench Press",
      "Dumbbell Bench Press", "Incline Dumbbell Press", "Dumbbell Fly",
      "Cable Fly", "Chest Press Machine", "Pec Deck", "Push-Up",
      "Incline Push-Up", "Dips (Chest)"
    ],
    "Back": [
      "Deadlift", "Barbell Row", "Pendlay Row", "Dumbbell Row",
      "T-Bar Row", "Seated Cable Row", "Lat Pulldown", "Pull-Up",
      "Chin-Up", "Face Pull", "Straight-Arm Pulldown", "Rack Pull",
      "Machine Row", "Shrug"
    ],
    "Legs": [
      "Back Squat", "Front Squat", "Goblet Squat", "Leg Press",
      "Romanian Deadlift", "Bulgarian Split Squat", "Lunge",
      "Walking Lunge", "Leg Extension", "Leg Curl", "Hip Thrust",
      "Calf Raise", "Seated Calf Raise", "Hack Squat", "Step-Up",
      "Sumo Deadlift"
    ],
    "Shoulders": [
      "Overhead Press", "Seated Dumbbell Press", "Arnold Press",
      "Lateral Raise", "Front Raise", "Rear Delt Fly",
      "Upright Row", "Cable Lateral Raise", "Machine Shoulder Press"
    ],
    "Arms": [
      "Barbell Curl", "Dumbbell Curl", "Hammer Curl", "Preacher Curl",
      "Concentration Curl", "Cable Curl", "Incline Dumbbell Curl",
      "Triceps Pushdown", "Overhead Triceps Extension", "Skull Crusher",
      "Close-Grip Bench Press", "Dips (Triceps)", "Triceps Kickback"
    ],
    "Core": [
      "Plank", "Side Plank", "Crunch", "Hanging Leg Raise",
      "Cable Crunch", "Russian Twist", "Ab Wheel Rollout",
      "Mountain Climber", "Bicycle Crunch", "Dead Bug", "Sit-Up"
    ],
    "Olympic & Power": [
      "Power Clean", "Clean and Jerk", "Snatch", "Push Press",
      "Clean Pull", "Kettlebell Swing", "Box Jump"
    ],
    "Cardio": [
      "Running", "Treadmill", "Cycling", "Stationary Bike", "Rowing",
      "Elliptical", "Stair Climber", "Jump Rope", "Swimming", "Walking",
      "Incline Walk", "HIIT"
    ]
  };

  // Flat list [{name, cat}] in catalog order, plus a quick name->cat map.
  var ALL = [];
  var CAT_OF = {};
  Object.keys(GROUPS).forEach(function (cat) {
    GROUPS[cat].forEach(function (name) {
      ALL.push({ name: name, cat: cat });
      CAT_OF[name.toLowerCase()] = cat;
    });
  });

  /** Category for a known library name (or "" if unknown/custom). */
  function categoryOf(name) {
    return CAT_OF[(name || "").trim().toLowerCase()] || "";
  }

  return {
    groups: GROUPS,
    all: function () { return ALL.slice(); },
    names: function () { return ALL.map(function (e) { return e.name; }); },
    categoryOf: categoryOf
  };
})();
