import { db } from './db';
import {
  DEFAULT_SETTINGS,
  type Day,
  type Entry,
  type Food,
  type Meal,
  type MealItem,
  type Settings,
  type Slot,
} from '../types';
import { SEED_FOODS, SEED_MEALS } from './seed-foods';

// ---------------------------------------------------------------- settings

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch });
}

// -------------------------------------------------------------------- days

/** Get the day, creating it with the carried-forward target if missing. */
export async function ensureDay(date: string): Promise<Day> {
  const existing = await db.days.get(date);
  if (existing) return existing;
  const settings = await getSettings();
  const day: Day = { date, targetGrams: settings.currentTarget, entries: [] };
  await db.days.put(day);
  return day;
}

/** Change a day's target; also becomes the default carried into future days. */
export async function setDayTarget(date: string, grams: number): Promise<void> {
  await db.transaction('rw', [db.days, db.settings], async () => {
    const day = await ensureDay(date);
    await db.days.put({ ...day, targetGrams: grams });
    await updateSettings({ currentTarget: grams });
  });
}

// ----------------------------------------------------------------- entries

async function bumpUsage(entry: Omit<Entry, 'id'>, date: string): Promise<void> {
  const id = entry.refId;
  if (id == null) return;
  // Atomic modify (not get-then-update) so two rapid adds never lose a count.
  const apply = (item: Food | Meal): void => {
    item.timesUsed = (item.timesUsed ?? 0) + 1;
    item.lastUsed = date;
    item.slotCounts = {
      ...(item.slotCounts ?? {}),
      [entry.slot]: (item.slotCounts?.[entry.slot] ?? 0) + 1,
    };
  };
  if (entry.refType === 'food') {
    await db.foods.where(':id').equals(id).modify(apply);
  } else {
    await db.meals.where(':id').equals(id).modify(apply);
  }
}

export async function addEntry(date: string, entry: Omit<Entry, 'id'>): Promise<Entry> {
  // The read-modify-write of the whole Day row runs inside a rw transaction
  // so concurrent calls serialize instead of clobbering each other's writes.
  const full = await db.transaction('rw', [db.days, db.settings], async () => {
    const day = await ensureDay(date);
    const created: Entry = { ...entry, id: crypto.randomUUID() };
    await db.days.put({ ...day, entries: [...day.entries, created] });
    return created;
  });
  // Usage bookkeeping is best-effort: the entry is already committed above,
  // so a bumpUsage failure must not make addEntry reject — callers building
  // retry-on-failure logic (e.g. voice confirm) treat a rejection as
  // "nothing persisted" and would double-log the entry on retry.
  await bumpUsage(entry, date).catch(() => {});
  return full;
}

export async function updateEntry(
  date: string,
  entryId: string,
  patch: Partial<Omit<Entry, 'id'>>,
): Promise<void> {
  await db.transaction('rw', [db.days, db.settings], async () => {
    const day = await ensureDay(date);
    await db.days.put({
      ...day,
      entries: day.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
    });
  });
}

export async function removeEntry(date: string, entryId: string): Promise<void> {
  await db.transaction('rw', [db.days, db.settings], async () => {
    const day = await ensureDay(date);
    await db.days.put({ ...day, entries: day.entries.filter((e) => e.id !== entryId) });
  });
}

export async function setEntryState(
  date: string,
  entryId: string,
  state: Entry['state'],
): Promise<void> {
  await updateEntry(date, entryId, { state });
}

/** Copy all of fromDate's entries onto toDate as fresh planned entries. */
export async function copyDay(fromDate: string, toDate: string): Promise<number> {
  const copies = await db.transaction('rw', [db.days, db.settings], async () => {
    const from = await db.days.get(fromDate);
    if (!from || from.entries.length === 0) return [] as Entry[];
    const to = await ensureDay(toDate);
    const list: Entry[] = from.entries.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      state: 'planned',
    }));
    await db.days.put({ ...to, entries: [...to.entries, ...list] });
    return list;
  });
  // Copying is the primary planning flow — it must feed usage learning
  // (most-used ordering, Fill-the-gap frequency bonus + variety penalty)
  // exactly like addEntry does. Best-effort for the same reason as addEntry:
  // the entries are already committed, so a usage failure must not reject.
  for (const c of copies) await bumpUsage(c, toDate).catch(() => {});
  return copies.length;
}

// ----------------------------------------------------- entry construction

export function makeFoodEntry(food: Food, qty: number, slot: Slot): Omit<Entry, 'id'> {
  return {
    refType: 'food',
    refId: food.id,
    name: food.name,
    fiberTotal: round1(food.fiberPerServing * qty),
    fiberPerUnit: food.fiberPerServing, // exact, unrounded — see Entry.fiberPerUnit
    qty,
    slot,
    state: 'planned',
  };
}

export function makeMealEntry(meal: Meal, qty: number, slot: Slot): Omit<Entry, 'id'> {
  return {
    refType: 'meal',
    refId: meal.id,
    name: meal.name,
    fiberTotal: round1(meal.totalFiber * qty),
    fiberPerUnit: meal.totalFiber, // exact, unrounded — see Entry.fiberPerUnit
    qty,
    slot,
    state: 'planned',
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ------------------------------------------------------------------- foods

export async function addFood(
  food: Omit<Food, 'id' | 'timesUsed'> & { timesUsed?: number },
): Promise<number> {
  return (await db.foods.add({ timesUsed: 0, ...food })) as number;
}

export async function updateFood(id: number, patch: Partial<Omit<Food, 'id'>>): Promise<void> {
  const before = patch.fiberPerServing !== undefined ? await db.foods.get(id) : undefined;
  await db.foods.update(id, patch);
  // A fiber edit must ripple into the denormalized totalFiber of every meal
  // containing this food — totals are always computed, never left stale.
  if (patch.fiberPerServing !== undefined && before?.fiberPerServing !== patch.fiberPerServing) {
    const meals = await db.meals.toArray();
    for (const meal of meals) {
      if (meal.items.some((i) => i.foodId === id)) {
        await db.meals.update(meal.id!, { totalFiber: await computeMealFiber(meal.items) });
      }
    }
  }
}

export async function deleteFood(id: number): Promise<void> {
  // Safe hard-delete: day entries snapshot name+fiber. Remove the food from
  // any meals that reference it and recompute their totals.
  await db.foods.delete(id);
  const meals = await db.meals.toArray();
  for (const meal of meals) {
    if (meal.items.some((i) => i.foodId === id)) {
      const items = meal.items.filter((i) => i.foodId !== id);
      await db.meals.update(meal.id!, { items, totalFiber: await computeMealFiber(items) });
    }
  }
}

// ------------------------------------------------------------------- meals

export async function computeMealFiber(items: MealItem[]): Promise<number> {
  let total = 0;
  for (const item of items) {
    const food = await db.foods.get(item.foodId);
    if (food) total += food.fiberPerServing * item.qty;
  }
  return round1(total);
}

export async function addMeal(
  meal: Omit<Meal, 'id' | 'timesUsed' | 'totalFiber'>,
): Promise<number> {
  const totalFiber = await computeMealFiber(meal.items);
  return (await db.meals.add({ timesUsed: 0, totalFiber, ...meal })) as number;
}

export async function updateMeal(id: number, patch: Partial<Omit<Meal, 'id'>>): Promise<void> {
  const existing = await db.meals.get(id);
  if (!existing) return;
  const items = patch.items ?? existing.items;
  const totalFiber = await computeMealFiber(items);
  await db.meals.update(id, { ...patch, totalFiber });
}

export async function deleteMeal(id: number): Promise<void> {
  await db.meals.delete(id);
}

// -------------------------------------------------------------------- seed

/** First-run: preload the starter library so day one isn't an empty app. */
export async function seedIfEmpty(): Promise<void> {
  const count = await db.foods.count();
  if (count > 0) return;

  const idByName = new Map<string, number>();
  for (const f of SEED_FOODS) {
    const id = (await db.foods.add({
      name: f.name,
      brand: f.brand,
      servingLabel: f.servingLabel,
      fiberPerServing: f.fiberPerServing,
      source: 'seed',
      favorite: f.favorite ?? false,
      timesUsed: 0,
    })) as number;
    idByName.set(f.name, id);
  }

  for (const m of SEED_MEALS) {
    const items: MealItem[] = [];
    for (const it of m.items) {
      const foodId = idByName.get(it.foodName);
      if (foodId != null) items.push({ foodId, qty: it.qty });
    }
    if (items.length === 0) continue;
    await db.meals.add({
      name: m.name,
      items,
      slotHint: m.slotHint,
      totalFiber: await computeMealFiber(items),
      favorite: false,
      timesUsed: 0,
    });
  }

  await getSettings(); // ensure default settings row exists
}
