import type { Food, Slot } from '../types';

/**
 * Starter library, preloaded on first run so day one isn't an empty app.
 *
 * Values are per-serving DIETARY FIBER in grams, rounded to 1 decimal, taken
 * from well-established USDA FoodData Central / SR Legacy figures (household
 * servings). Where fiber differs by preparation, the serving label says which
 * form the value is for (e.g. "cooked", "with skin", "dried"). Branded items
 * carry the printed nutrition-label value and have `brand` set.
 */
export interface SeedFood {
  name: string;
  brand?: string;
  servingLabel: string;
  fiberPerServing: number;
  favorite?: boolean;
}

export interface SeedMeal {
  name: string;
  slotHint?: Slot;
  items: Array<{ foodName: string; qty: number }>;
}

export const SEED_FOODS: SeedFood[] = [
  // ------------------------------------------------------- berries & fruit
  { name: 'Raspberries', servingLabel: '1 cup', fiberPerServing: 8.0, favorite: true },
  { name: 'Blackberries', servingLabel: '1 cup', fiberPerServing: 7.6 },
  { name: 'Blueberries', servingLabel: '1 cup', fiberPerServing: 3.6 },
  { name: 'Strawberries', servingLabel: '1 cup, halved', fiberPerServing: 3.0 },
  { name: 'Pear, with skin', servingLabel: '1 medium', fiberPerServing: 5.5 },
  { name: 'Apple, with skin', servingLabel: '1 medium', fiberPerServing: 4.4, favorite: true },
  { name: 'Banana', servingLabel: '1 medium', fiberPerServing: 3.1 },
  { name: 'Orange', servingLabel: '1 medium', fiberPerServing: 3.1 },
  { name: 'Kiwi', servingLabel: '1 fruit', fiberPerServing: 2.1 },
  { name: 'Avocado', servingLabel: '1/2 medium', fiberPerServing: 4.6, favorite: true },
  { name: 'Prunes', servingLabel: '5 prunes', fiberPerServing: 3.4 },
  { name: 'Figs, dried', servingLabel: '1/4 cup', fiberPerServing: 3.7 },
  { name: 'Dates, Medjool', servingLabel: '2 dates', fiberPerServing: 3.2 },
  { name: 'Mango', servingLabel: '1 cup, pieces', fiberPerServing: 2.6 },

  // ------------------------------------------------------------ vegetables
  { name: 'Broccoli, cooked', servingLabel: '1 cup, chopped', fiberPerServing: 5.1 },
  { name: 'Brussels sprouts, cooked', servingLabel: '1 cup', fiberPerServing: 4.1 },
  { name: 'Carrot, raw', servingLabel: '1 medium', fiberPerServing: 1.7 },
  { name: 'Sweet potato, baked with skin', servingLabel: '1 medium', fiberPerServing: 3.8 },
  { name: 'Green peas, cooked', servingLabel: '1/2 cup', fiberPerServing: 4.4 },
  { name: 'Artichoke hearts, cooked', servingLabel: '1/2 cup', fiberPerServing: 4.8 },
  { name: 'Corn on the cob', servingLabel: '1 medium ear', fiberPerServing: 2.5 },
  { name: 'Spinach, cooked', servingLabel: '1/2 cup', fiberPerServing: 2.2 },
  { name: 'Butternut squash, baked', servingLabel: '1 cup, cubed', fiberPerServing: 6.6 },
  { name: 'Cauliflower, cooked', servingLabel: '1 cup', fiberPerServing: 2.9 },
  { name: 'Green beans, cooked', servingLabel: '1 cup', fiberPerServing: 4.0 },
  { name: 'Potato, baked with skin', servingLabel: '1 medium', fiberPerServing: 3.8 },

  // --------------------------------------------------------------- legumes
  { name: 'Lentils, cooked', servingLabel: '1/2 cup', fiberPerServing: 7.8, favorite: true },
  { name: 'Black beans, cooked', servingLabel: '1/2 cup', fiberPerServing: 7.5, favorite: true },
  { name: 'Kidney beans, cooked', servingLabel: '1/2 cup', fiberPerServing: 5.7 },
  { name: 'Pinto beans, cooked', servingLabel: '1/2 cup', fiberPerServing: 7.7 },
  { name: 'Navy beans, cooked', servingLabel: '1/2 cup', fiberPerServing: 9.6 },
  { name: 'Chickpeas, cooked', servingLabel: '1/2 cup', fiberPerServing: 6.3 },
  { name: 'Split peas, cooked', servingLabel: '1/2 cup', fiberPerServing: 8.1 },
  { name: 'Edamame, shelled, cooked', servingLabel: '1/2 cup', fiberPerServing: 4.1 },
  { name: 'Hummus', servingLabel: '2 tbsp', fiberPerServing: 1.8 },
  { name: 'Baked beans, canned', servingLabel: '1/2 cup', fiberPerServing: 5.2 },

  // ------------------------------------------------------- grains & breads
  { name: 'Oats, dry', servingLabel: '1/2 cup (old-fashioned)', fiberPerServing: 4.0, favorite: true },
  { name: 'Quinoa, cooked', servingLabel: '1 cup', fiberPerServing: 5.2 },
  { name: 'Brown rice, cooked', servingLabel: '1 cup', fiberPerServing: 3.5 },
  { name: 'Whole-wheat spaghetti, cooked', servingLabel: '1 cup', fiberPerServing: 6.3 },
  { name: 'Pearl barley, cooked', servingLabel: '1 cup', fiberPerServing: 6.0 },
  { name: 'Bulgur, cooked', servingLabel: '1 cup', fiberPerServing: 8.2 },
  { name: 'Whole-wheat bread', servingLabel: '1 slice', fiberPerServing: 2.0 },
  { name: 'Whole-wheat English muffin', servingLabel: '1 muffin', fiberPerServing: 4.4 },
  { name: 'Popcorn, air-popped', servingLabel: '3 cups', fiberPerServing: 3.5 },
  { name: 'Bran flakes', servingLabel: '3/4 cup', fiberPerServing: 5.5 },
  { name: 'Corn tortillas', servingLabel: '2 tortillas (6 in)', fiberPerServing: 3.0 },

  // ---------------------------------------------------------- nuts & seeds
  { name: 'Chia seeds', servingLabel: '1 tbsp', fiberPerServing: 4.1, favorite: true },
  { name: 'Flaxseed, ground', servingLabel: '1 tbsp', fiberPerServing: 1.9 },
  { name: 'Almonds', servingLabel: '1 oz (23 nuts)', fiberPerServing: 3.5 },
  { name: 'Pistachios', servingLabel: '1 oz (49 kernels)', fiberPerServing: 3.0 },
  { name: 'Sunflower seeds, hulled', servingLabel: '1/4 cup', fiberPerServing: 3.0 },
  { name: 'Peanut butter', servingLabel: '2 tbsp', fiberPerServing: 1.9 },
  { name: 'Walnuts', servingLabel: '1 oz (14 halves)', fiberPerServing: 1.9 },
  { name: 'Pumpkin seeds, hulled', servingLabel: '1 oz (28 g)', fiberPerServing: 1.8 },

  // ------------------------------------- branded staples (label values)
  {
    name: '21 Whole Grains & Seeds bread',
    brand: "Dave's Killer Bread",
    servingLabel: '1 slice',
    fiberPerServing: 5.0,
    favorite: true,
  },
  {
    name: 'Fiber One Original cereal',
    brand: 'General Mills',
    servingLabel: '2/3 cup',
    fiberPerServing: 18.0,
  },
  {
    name: 'Carb Balance flour tortilla, soft taco size',
    brand: 'Mission',
    servingLabel: '1 tortilla',
    fiberPerServing: 15.0,
  },
  {
    name: 'Psyllium fiber powder',
    brand: 'Metamucil',
    servingLabel: '1 dose (per label)',
    fiberPerServing: 3.0,
  },
];

/**
 * Starter meals. Items reference SEED_FOODS by exact name; qty is servings
 * of that food (0.5 steps are fine). Totals are computed by the repo layer.
 */
export const SEED_MEALS: SeedMeal[] = [
  {
    // ~12.1 g
    name: 'Overnight oats + raspberries',
    slotHint: 'breakfast',
    items: [
      { foodName: 'Oats, dry', qty: 1 },
      { foodName: 'Chia seeds', qty: 1 },
      { foodName: 'Raspberries', qty: 0.5 },
    ],
  },
  {
    // ~9.6 g
    name: 'Avocado toast',
    slotHint: 'breakfast',
    items: [
      { foodName: '21 Whole Grains & Seeds bread', qty: 1 },
      { foodName: 'Avocado', qty: 1 },
    ],
  },
  {
    // ~15.4 g
    name: 'Lentil soup + bread',
    slotHint: 'lunch',
    items: [
      { foodName: 'Lentils, cooked', qty: 1.5 },
      { foodName: 'Carrot, raw', qty: 1 },
      { foodName: 'Whole-wheat bread', qty: 1 },
    ],
  },
  {
    // ~12.7 g
    name: 'Chickpea salad bowl',
    slotHint: 'lunch',
    items: [
      { foodName: 'Chickpeas, cooked', qty: 1 },
      { foodName: 'Quinoa, cooked', qty: 0.5 },
      { foodName: 'Avocado', qty: 0.5 },
      { foodName: 'Sunflower seeds, hulled', qty: 0.5 },
    ],
  },
  {
    // ~12.8 g
    name: 'Black bean tacos',
    slotHint: 'dinner',
    items: [
      { foodName: 'Black beans, cooked', qty: 1 },
      { foodName: 'Corn tortillas', qty: 1 },
      { foodName: 'Avocado', qty: 0.5 },
    ],
  },
  {
    // ~6.3 g
    name: 'Apple + peanut butter',
    slotHint: 'snack',
    items: [
      { foodName: 'Apple, with skin', qty: 1 },
      { foodName: 'Peanut butter', qty: 1 },
    ],
  },
];

// re-export type for convenience of consumers
export type { Food };
