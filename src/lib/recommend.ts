/**
 * Local learning recommendation engine for "Fill the gap".
 * No network, no AI call — it ranks the user's own foods and meals against
 * today's remaining grams, using her real usage history (favorites, how often
 * and when she logs things). Deterministic for a given db state and date;
 * near-tied scores rotate day to day via a date-seeded shuffle.
 */
import { db } from '../db/db';
import { addDays } from './dates';
import { gapGrams } from './fiber';
import { makeFoodEntry, makeMealEntry } from '../db/repo';
import {
  DEFAULT_SETTINGS,
  SLOTS,
  type Day,
  type Entry,
  type Food,
  type Meal,
  type Slot,
} from '../types';

export interface Suggestion {
  kind: 'food' | 'meal' | 'pair';
  title: string;
  fiber: number;
  slot: Slot;
  reason: string;
  entries: Array<Omit<Entry, 'id'>>;
}

interface Candidate {
  kind: 'food' | 'meal';
  item: Food | Meal;
  fiber: number;
  slot: Slot;
  score: number;
  /** score minus the gap-fit component — reused when scoring pairs. */
  bonus: number;
}

export async function suggestForGap(date: string, count = 4): Promise<Suggestion[]> {
  const [existingDay, settings, foods, meals] = await Promise.all([
    db.days.get(date),
    db.settings.get('app'),
    db.foods.toArray(),
    db.meals.toArray(),
  ]);
  const day: Day = existingDay ?? {
    date,
    targetGrams: settings?.currentTarget ?? DEFAULT_SETTINGS.currentTarget,
    entries: [],
  };
  const gap = gapGrams(day);
  if (gap <= 0) return [];

  // ---- slot occupancy: prefer empty slots; snack may hold two things ----
  const slotFill: Record<Slot, number> = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
  for (const e of day.entries) slotFill[e.slot] += 1;
  const slotOpen = (s: Slot): boolean => slotFill[s] === 0 || (s === 'snack' && slotFill[s] < 2);
  const openSlots = SLOTS.filter(slotOpen);
  const firstOpenSlot: Slot = openSlots.length > 0 ? openSlots[0] : 'snack';

  const yesterday = addDays(date, -1);
  const aWhileAgo = addDays(date, -4);

  // ---- fit: closeness to the gap; overshoot penalized at half rate ----
  const fit = (fiber: number): number => {
    const diff = fiber - gap;
    const dist = diff > 0 ? diff * 0.5 : -diff;
    return 1 - Math.min(1, dist / Math.max(gap, 1));
  };

  const bestSlotFor = (item: Food | Meal, kind: 'food' | 'meal'): Slot => {
    if (kind === 'meal') {
      const hint = (item as Meal).slotHint;
      if (hint) return hint;
    }
    let best: Slot | undefined;
    let bestN = 0;
    for (const s of SLOTS) {
      const n = item.slotCounts?.[s] ?? 0;
      if (n > bestN) {
        bestN = n;
        best = s;
      }
    }
    return best ?? firstOpenSlot;
  };

  const buildCandidate = (item: Food | Meal, kind: 'food' | 'meal', fiber: number): Candidate => {
    const slot = bestSlotFor(item, kind);
    let bonus = 0;
    if (item.favorite) bonus += 0.35;
    bonus += Math.log1p(item.timesUsed ?? 0) * 0.15;
    if (item.lastUsed === date || item.lastUsed === yesterday) bonus -= 0.5; // variety
    if (slotOpen(slot)) bonus += 0.2;
    return { kind, item, fiber, slot, score: fit(fiber) + bonus, bonus };
  };

  const candidates: Candidate[] = [];
  for (const f of foods) {
    if (f.fiberPerServing > 0) candidates.push(buildCandidate(f, 'food', f.fiberPerServing));
  }
  for (const m of meals) {
    if (m.items.length > 0 && m.totalFiber > 0) candidates.push(buildCandidate(m, 'meal', m.totalFiber));
  }
  candidates.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  const nearGap = (fiber: number): boolean => Math.abs(fiber - gap) <= 1.5;

  const reasonFor = (c: Candidate): string => {
    const used = c.item.timesUsed ?? 0;
    const restedAWhile = c.item.lastUsed !== undefined && c.item.lastUsed <= aWhileAgo;
    if (c.kind === 'meal' && used >= 3) return 'Your meal · you make this often';
    if (c.item.favorite && nearGap(c.fiber)) return 'Favorite · fills the gap almost exactly';
    if (nearGap(c.fiber)) return 'Fills the gap almost exactly';
    if (restedAWhile) return "Haven't had this in a while";
    if (c.item.favorite) return 'One of your favorites';
    if (used >= 3) return 'You reach for this often';
    if (c.kind === 'meal') return 'Your meal · one tap plans the whole thing';
    return 'From your library';
  };

  const toSuggestion = (c: Candidate): Suggestion => ({
    kind: c.kind,
    title: c.item.name,
    fiber: round1(c.fiber),
    slot: c.slot,
    reason: reasonFor(c),
    entries:
      c.kind === 'food'
        ? [makeFoodEntry(c.item as Food, 1, c.slot)]
        : [makeMealEntry(c.item as Meal, 1, c.slot)],
  });

  const scored: Array<{ sug: Suggestion; score: number }> = candidates.map((c) => ({
    sug: toSuggestion(c),
    score: c.score,
  }));

  // ---- pairs: when even the best single leaves >1 g unfilled, compose two
  // top foods that together land on the gap (within [gap-1, gap+4]) ----
  if (candidates.length > 0 && candidates[0].fiber < gap - 1) {
    const topFoods = candidates.filter((c) => c.kind === 'food').slice(0, 8);
    const pairs: Array<{ sug: Suggestion; score: number }> = [];
    for (let i = 0; i < topFoods.length; i++) {
      for (let j = i + 1; j < topFoods.length; j++) {
        const a = topFoods[i];
        const b = topFoods[j];
        const combined = a.fiber + b.fiber;
        if (combined < gap - 1 || combined > gap + 4) continue;
        const slot = a.slot;
        const bothFavorites = a.item.favorite && b.item.favorite;
        // Build the entries first and display the sum of what they actually
        // store, so the card's grams always match the grams that get added.
        const entries = [
          makeFoodEntry(a.item as Food, 1, slot),
          makeFoodEntry(b.item as Food, 1, slot),
        ];
        pairs.push({
          sug: {
            kind: 'pair',
            title: `${a.item.name} + ${b.item.name}`,
            fiber: round1(entries[0].fiberTotal + entries[1].fiberTotal),
            slot,
            reason: bothFavorites ? 'Two favorites that add up' : 'Two of your foods that add up',
            entries,
          },
          score: fit(combined) + (a.bonus + b.bonus) / 2,
        });
      }
    }
    pairs.sort((a, b) => b.score - a.score || a.sug.title.localeCompare(b.sug.title));
    scored.push(...pairs.slice(0, 2));
  }

  scored.sort((a, b) => b.score - a.score || a.sug.title.localeCompare(b.sug.title));
  shuffleNearTies(scored, date);
  return scored.slice(0, Math.max(0, count)).map((s) => s.sug);
}

// ------------------------------------------------------------------ helpers

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** FNV-1a string hash → 32-bit unsigned int. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffle runs of near-tied scores (within 0.1 of the run
 * leader) seeded by the date, so suggestions rotate day to day but stay
 * stable within a day. Operates on the full sorted list before slicing, so
 * asking for a larger count extends the same ordering.
 */
function shuffleNearTies<T extends { score: number }>(list: T[], seedStr: string): void {
  const rng = mulberry32(hashString(seedStr));
  let i = 0;
  while (i < list.length) {
    let j = i + 1;
    while (j < list.length && list[i].score - list[j].score < 0.1) j++;
    for (let k = j - 1; k > i; k--) {
      const m = i + Math.floor(rng() * (k - i + 1));
      const tmp = list[k];
      list[k] = list[m];
      list[m] = tmp;
    }
    i = j;
  }
}
