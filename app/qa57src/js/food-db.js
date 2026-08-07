/* ============================================================
   food-db.js — built-in starter food database (Coach 2.0 QoL).

   ~70 everyday foods with macros per a stated serving, so new users
   aren't inventing calorie numbers from day one (the #1 complaint in
   user testing). Values are typical-label numbers (kcal, protein g,
   carbs g, fat g) — everything stays editable in the form. The user's
   OWN logged meals always rank above these in autocomplete.
   Nutrition facts are data, not copyrightable — no license concerns.
   ============================================================ */

window.OF = window.OF || {};

OF.foodDB = (function () {
  "use strict";

  /* Tags let the app RESPECT the diet the interview collected (testers found
     a vegan being offered dairy and a halal user being offered pork + beer). */
  var MEAT = "meat", PORK = "pork", DAIRY = "dairy", EGG = "egg", FISH = "fish",
      ALC = "alcohol", GLUTEN = "gluten";

  /* [name+serving, kcal, protein, carbs, fat, tags[]] */
  var FOODS = [
    ["Eggs (2 large)", 143, 13, 1, 10, [EGG]],
    ["Egg whites (4)", 68, 14, 1, 0, [EGG]],
    ["Oatmeal (1 cup cooked)", 158, 6, 27, 3],
    ["Greek yogurt, plain (1 cup)", 146, 20, 8, 4, [DAIRY]],
    ["Whey protein (1 scoop)", 120, 24, 3, 1.5, [DAIRY]],
    ["Protein bar", 210, 20, 22, 7, [DAIRY]],
    ["Banana", 105, 1, 27, 0],
    ["Apple", 95, 0, 25, 0],
    ["Orange", 62, 1, 15, 0],
    ["Berries (1 cup)", 65, 1, 15, 0.5],
    ["Peanut butter (2 tbsp)", 188, 8, 7, 16],
    ["Almonds (1 oz / handful)", 164, 6, 6, 14],
    ["Toast with butter (2 slices)", 220, 6, 28, 9, [DAIRY, GLUTEN]],
    ["Bagel with cream cheese", 360, 11, 56, 10, [DAIRY, GLUTEN]],
    ["Avocado toast", 290, 7, 30, 16, [GLUTEN]],
    ["Cereal with milk (1 bowl)", 250, 9, 42, 5, [DAIRY, GLUTEN]],
    ["Pancakes (3) with syrup", 520, 8, 91, 14, [DAIRY, EGG, GLUTEN]],
    ["Chicken breast (6 oz cooked)", 280, 53, 0, 6, [MEAT]],
    ["Chicken thigh (6 oz cooked)", 360, 44, 0, 19, [MEAT]],
    ["Grilled chicken sandwich", 420, 32, 44, 12, [MEAT, GLUTEN]],
    ["Ground beef 85% (6 oz cooked)", 426, 42, 0, 27, [MEAT]],
    ["Steak (6 oz cooked)", 342, 46, 0, 16, [MEAT]],
    ["Salmon (6 oz cooked)", 350, 38, 0, 21, [FISH]],
    ["Tuna (1 can, in water)", 100, 22, 0, 1, [FISH]],
    ["Shrimp (6 oz cooked)", 202, 39, 2, 3, [FISH]],
    ["Ground turkey (6 oz cooked)", 320, 40, 0, 17, [MEAT]],
    ["Pork chop (6 oz cooked)", 330, 46, 0, 15, [MEAT, PORK]],
    ["White rice (1 cup cooked)", 205, 4, 45, 0],
    ["Brown rice (1 cup cooked)", 216, 5, 45, 2],
    ["Pasta (1.5 cups cooked)", 330, 12, 65, 2, [GLUTEN]],
    ["Pasta with marinara (1.5 cups)", 400, 14, 76, 5, [GLUTEN]],
    ["Potato, baked (medium)", 161, 4, 37, 0],
    ["Sweet potato (medium)", 103, 2, 24, 0],
    ["French fries (medium)", 365, 4, 48, 17],
    ["Quinoa (1 cup cooked)", 222, 8, 39, 4],
    ["Bread (1 slice)", 80, 3, 14, 1, [GLUTEN]],
    ["Tortilla (large flour)", 150, 4, 25, 4, [GLUTEN]],
    ["Tofu (6 oz firm)", 144, 16, 4, 8],
    ["Tempeh (4 oz)", 226, 22, 10, 12],
    ["Paneer (4 oz)", 340, 21, 5, 27, [DAIRY]],
    ["Lentils (1 cup cooked)", 230, 18, 40, 1],
    ["Chickpeas (1 cup cooked)", 269, 15, 45, 4],
    ["Black beans (1 cup cooked)", 227, 15, 41, 1],
    ["Dal (1 cup)", 220, 12, 32, 5],
    ["Hummus (1/4 cup)", 100, 5, 9, 6],
    ["Edamame (1 cup)", 188, 18, 14, 8],
    ["Cottage cheese (1 cup)", 183, 24, 8, 5, [DAIRY]],
    ["Cheese (1 oz)", 114, 7, 0, 9, [DAIRY]],
    ["Milk, 2% (1 cup)", 122, 8, 12, 5, [DAIRY]],
    ["Salad with grilled chicken", 380, 35, 14, 20, [MEAT]],
    ["Caesar salad (side)", 190, 5, 10, 15, [DAIRY, EGG]],
    ["Burrito bowl (chicken)", 690, 42, 72, 25, [MEAT]],
    ["Chicken rice bowl", 620, 45, 70, 15, [MEAT]],
    ["Turkey sandwich", 350, 22, 42, 10, [MEAT, GLUTEN]],
    ["Peanut butter & jelly sandwich", 390, 12, 49, 17, [GLUTEN]],
    ["Cheeseburger", 540, 28, 42, 28, [MEAT, DAIRY, GLUTEN]],
    ["Slice of pizza (cheese)", 285, 12, 36, 10, [DAIRY, GLUTEN]],
    ["Sushi roll (8 pieces)", 300, 12, 50, 5, [FISH]],
    ["Ramen (restaurant bowl)", 650, 27, 84, 22, [MEAT, EGG, GLUTEN]],
    ["Stir-fry with rice (chicken)", 580, 36, 68, 16, [MEAT]],
    ["Eggs fried rice (1.5 cups)", 470, 14, 62, 18, [EGG]],
    ["Protein shake with milk", 250, 32, 15, 6, [DAIRY]],
    ["Smoothie (fruit + yogurt)", 280, 9, 55, 3, [DAIRY]],
    ["Trail mix (1/4 cup)", 175, 5, 16, 11],
    ["Dark chocolate (2 squares)", 120, 2, 9, 9, [DAIRY]],
    ["Ice cream (1 cup)", 274, 5, 31, 15, [DAIRY]],
    ["Cookie (large)", 220, 2, 30, 11, [DAIRY, EGG, GLUTEN]],
    ["Potato chips (1 oz bag)", 152, 2, 15, 10],
    ["Beer (12 oz)", 153, 2, 13, 0, [ALC, GLUTEN]],
    ["Wine (5 oz glass)", 123, 0, 4, 0, [ALC]],
    // plant-protein staples (a vegan tester couldn't hit 180 g/day from the DB)
    ["Seitan (4 oz)", 130, 25, 6, 2, [GLUTEN]],
    ["Plant protein powder (1 scoop)", 120, 24, 4, 2, []],
    ["Soy milk (1 cup)", 105, 6, 12, 4, []],
    ["Soy curls / TVP (1 cup)", 160, 24, 14, 3, []],
    ["Vegan protein bar", 220, 20, 24, 8, []],
    ["Peanuts (1 oz)", 161, 7, 5, 14, []],
    ["Chia pudding (1 cup)", 240, 8, 24, 12, []],
    ["Falafel (4 pieces)", 230, 9, 24, 12, []],
    ["Veggie burger patty", 190, 20, 9, 8, []],
    ["Nutritional yeast (2 tbsp)", 45, 5, 5, 1, []]
  ];

  function row(f) {
    return { name: f[0], calories: f[1], protein: f[2], carbs: f[3], fat: f[4], tags: f[5] || [] };
  }

  /** Which tags a set of dietary restrictions forbids. */
  function excludedTags(restrictions) {
    var r = (restrictions || []).map(function (x) { return String(x).toLowerCase(); });
    var out = {};
    function ban(list) { list.forEach(function (t) { out[t] = true; }); }
    if (r.indexOf("vegan") !== -1) ban([MEAT, PORK, DAIRY, EGG, FISH]);
    if (r.indexOf("vegetarian") !== -1) ban([MEAT, PORK, FISH]);
    if (r.indexOf("halal") !== -1) ban([PORK, ALC]);
    if (r.indexOf("kosher") !== -1) ban([PORK]);
    if (r.indexOf("lactose-free") !== -1) ban([DAIRY]);
    if (r.indexOf("gluten-free") !== -1) ban([GLUTEN]);
    return Object.keys(out);
  }

  /** Foods the user can actually eat (restrictions come from the profile). */
  function all(restrictions) {
    var banned = excludedTags(restrictions);
    if (!banned.length) return FOODS.map(row);
    return FOODS.filter(function (f) {
      var t = f[5] || [];
      return !t.some(function (x) { return banned.indexOf(x) !== -1; });
    }).map(row);
  }

  /** Case-insensitive exact-name lookup. */
  function find(name) {
    var k = String(name || "").trim().toLowerCase();
    if (!k) return null;
    for (var i = 0; i < FOODS.length; i++) {
      if (FOODS[i][0].toLowerCase() === k) return row(FOODS[i]);
    }
    return null;
  }

  return { all: all, find: find, excludedTags: excludedTags };
})();
