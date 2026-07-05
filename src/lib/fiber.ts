import type { Day } from '../types';

/**
 * Round to 1 decimal. Entry fiberTotal snapshots and day targets are all
 * stored as 1-decimal values, so rounding the sums here keeps every total
 * exact — float drift like 8.2+5.2+3.7+5.5 = 22.599999999999998 would
 * otherwise make `eaten >= target` misclassify exact-hit days.
 */
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function eatenTotal(day: Day): number {
  return round1(
    day.entries.filter((e) => e.state === 'eaten').reduce((sum, e) => sum + e.fiberTotal, 0),
  );
}

/** Planned but not yet eaten. */
export function plannedTotal(day: Day): number {
  return round1(
    day.entries.filter((e) => e.state === 'planned').reduce((sum, e) => sum + e.fiberTotal, 0),
  );
}

/** Everything on the plan for the day, eaten or not. */
export function dayTotal(day: Day): number {
  return round1(day.entries.reduce((sum, e) => sum + e.fiberTotal, 0));
}

/** Grams still unaccounted for vs. the target (never negative). */
export function gapGrams(day: Day): number {
  return round1(Math.max(0, day.targetGrams - dayTotal(day)));
}

/** Format grams: one decimal, trailing ".0" trimmed. e.g. 8 → "8", 6.25 → "6.3" */
export function fmtG(n: number): string {
  const rounded = round1(n);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Parse a user-typed grams value, accepting a comma decimal separator
 * (iOS decimal keyboards insert ',' in many locales). '' parses to NaN.
 */
export function parseGrams(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.'));
}
