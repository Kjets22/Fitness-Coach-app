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

  /* [name+serving, kcal, protein, carbs, fat] */
  var FOODS = [
    ["Eggs (2 large)", 143, 13, 1, 10],
    ["Egg whites (4)", 68, 14, 1, 0],
    ["Oatmeal (1 cup cooked)", 158, 6, 27, 3],
    ["Greek yogurt, plain (1 cup)", 146, 20, 8, 4],
    ["Whey protein (1 scoop)", 120, 24, 3, 1.5],
    ["Protein bar", 210, 20, 22, 7],
    ["Banana", 105, 1, 27, 0],
    ["Apple", 95, 0, 25, 0],
    ["Orange", 62, 1, 15, 0],
    ["Berries (1 cup)", 65, 1, 15, 0.5],
    ["Peanut butter (2 tbsp)", 188, 8, 7, 16],
    ["Almonds (1 oz / handful)", 164, 6, 6, 14],
    ["Toast with butter (2 slices)", 220, 6, 28, 9],
    ["Bagel with cream cheese", 360, 11, 56, 10],
    ["Avocado toast", 290, 7, 30, 16],
    ["Cereal with milk (1 bowl)", 250, 9, 42, 5],
    ["Pancakes (3) with syrup", 520, 8, 91, 14],
    ["Chicken breast (6 oz cooked)", 280, 53, 0, 6],
    ["Chicken thigh (6 oz cooked)", 360, 44, 0, 19],
    ["Grilled chicken sandwich", 420, 32, 44, 12],
    ["Ground beef 85% (6 oz cooked)", 426, 42, 0, 27],
    ["Steak (6 oz cooked)", 342, 46, 0, 16],
    ["Salmon (6 oz cooked)", 350, 38, 0, 21],
    ["Tuna (1 can, in water)", 100, 22, 0, 1],
    ["Shrimp (6 oz cooked)", 202, 39, 2, 3],
    ["Ground turkey (6 oz cooked)", 320, 40, 0, 17],
    ["Pork chop (6 oz cooked)", 330, 46, 0, 15],
    ["White rice (1 cup cooked)", 205, 4, 45, 0],
    ["Brown rice (1 cup cooked)", 216, 5, 45, 2],
    ["Pasta (1.5 cups cooked)", 330, 12, 65, 2],
    ["Pasta with marinara (1.5 cups)", 400, 14, 76, 5],
    ["Potato, baked (medium)", 161, 4, 37, 0],
    ["Sweet potato (medium)", 103, 2, 24, 0],
    ["French fries (medium)", 365, 4, 48, 17],
    ["Quinoa (1 cup cooked)", 222, 8, 39, 4],
    ["Bread (1 slice)", 80, 3, 14, 1],
    ["Tortilla (large flour)", 150, 4, 25, 4],
    ["Tofu (6 oz firm)", 144, 16, 4, 8],
    ["Tempeh (4 oz)", 226, 22, 10, 12],
    ["Paneer (4 oz)", 340, 21, 5, 27],
    ["Lentils (1 cup cooked)", 230, 18, 40, 1],
    ["Chickpeas (1 cup cooked)", 269, 15, 45, 4],
    ["Black beans (1 cup cooked)", 227, 15, 41, 1],
    ["Dal (1 cup)", 220, 12, 32, 5],
    ["Hummus (1/4 cup)", 100, 5, 9, 6],
    ["Edamame (1 cup)", 188, 18, 14, 8],
    ["Cottage cheese (1 cup)", 183, 24, 8, 5],
    ["Cheese (1 oz)", 114, 7, 0, 9],
    ["Milk, 2% (1 cup)", 122, 8, 12, 5],
    ["Salad with grilled chicken", 380, 35, 14, 20],
    ["Caesar salad (side)", 190, 5, 10, 15],
    ["Burrito bowl (chicken)", 690, 42, 72, 25],
    ["Chicken rice bowl", 620, 45, 70, 15],
    ["Turkey sandwich", 350, 22, 42, 10],
    ["Peanut butter & jelly sandwich", 390, 12, 49, 17],
    ["Cheeseburger", 540, 28, 42, 28],
    ["Slice of pizza (cheese)", 285, 12, 36, 10],
    ["Sushi roll (8 pieces)", 300, 12, 50, 5],
    ["Ramen (restaurant bowl)", 650, 27, 84, 22],
    ["Stir-fry with rice (chicken)", 580, 36, 68, 16],
    ["Eggs fried rice (1.5 cups)", 470, 14, 62, 18],
    ["Protein shake with milk", 250, 32, 15, 6],
    ["Smoothie (fruit + yogurt)", 280, 9, 55, 3],
    ["Trail mix (1/4 cup)", 175, 5, 16, 11],
    ["Dark chocolate (2 squares)", 120, 2, 9, 9],
    ["Ice cream (1 cup)", 274, 5, 31, 15],
    ["Cookie (large)", 220, 2, 30, 11],
    ["Potato chips (1 oz bag)", 152, 2, 15, 10],
    ["Beer (12 oz)", 153, 2, 13, 0],
    ["Wine (5 oz glass)", 123, 0, 4, 0]
  ];

  function all() {
    return FOODS.map(function (f) {
      return { name: f[0], calories: f[1], protein: f[2], carbs: f[3], fat: f[4] };
    });
  }

  /** Case-insensitive exact-name lookup. */
  function find(name) {
    var k = String(name || "").trim().toLowerCase();
    if (!k) return null;
    for (var i = 0; i < FOODS.length; i++) {
      if (FOODS[i][0].toLowerCase() === k) {
        return { name: FOODS[i][0], calories: FOODS[i][1], protein: FOODS[i][2], carbs: FOODS[i][3], fat: FOODS[i][4] };
      }
    }
    return null;
  }

  return { all: all, find: find };
})();
