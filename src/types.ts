export type Slot = 'breakfast' | 'lunch' | 'snack' | 'dinner';

export const SLOTS: Slot[] = ['breakfast', 'lunch', 'snack', 'dinner'];

export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  snack: 'Snack',
  dinner: 'Dinner',
};

export interface Food {
  id?: number;
  name: string;
  brand?: string;
  servingLabel: string; // e.g. "1 slice (45 g)" or "1 cup"
  fiberPerServing: number; // grams
  source: 'seed' | 'manual' | 'label' | 'estimate' | 'usda';
  favorite: boolean;
  timesUsed: number;
  lastUsed?: string; // date key YYYY-MM-DD
  slotCounts?: Partial<Record<Slot, number>>; // learned slot preferences
}

export interface MealItem {
  foodId: number;
  qty: number; // servings of that food
}

export interface Meal {
  id?: number;
  name: string;
  items: MealItem[];
  slotHint?: Slot;
  totalFiber: number; // denormalized; recomputed whenever items change
  favorite: boolean;
  timesUsed: number;
  lastUsed?: string;
  slotCounts?: Partial<Record<Slot, number>>;
}

/**
 * An entry snapshots name + fiber at the moment it's added, so editing or
 * deleting a library food never rewrites the historical record.
 */
export interface Entry {
  id: string; // crypto.randomUUID()
  refType: 'food' | 'meal';
  refId?: number; // absent for one-off custom entries
  name: string; // snapshot
  fiberTotal: number; // snapshot: fiber for the full quantity, rounded to 1 decimal
  /**
   * Snapshot of the exact (unrounded) fiber per single unit of qty, so
   * quantity changes never re-derive it from the rounded total and compound
   * rounding drift. Optional: entries persisted before this field existed
   * fall back to fiberTotal / qty.
   */
  fiberPerUnit?: number;
  qty: number;
  slot: Slot;
  state: 'planned' | 'eaten';
}

export interface Day {
  date: string; // local date key YYYY-MM-DD
  targetGrams: number;
  entries: Entry[];
}

export interface Settings {
  id: string; // always 'app'
  currentTarget: number; // carried forward into each new day
  closeMarginGrams: number; // history: within this of target counts as "close"
  apiKey?: string; // Anthropic API key for label scanning
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  currentTarget: 22,
  closeMarginGrams: 2,
};
