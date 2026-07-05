import type { Day } from '../types';
import { eatenTotal } from './fiber';
import { dateKey } from './dates';

export type DayOutcome = 'hit' | 'close' | 'missed' | 'empty';

/**
 * Outcome of a day based on what was actually EATEN — planned-but-unchecked
 * entries never count toward hit/close. The target is a floor, not a
 * ceiling: anything at or past it is a hit, however far over.
 */
export function dayOutcome(day: Day | undefined, closeMarginGrams: number): DayOutcome {
  if (!day || day.entries.length === 0) return 'empty';
  const eaten = eatenTotal(day);
  if (eaten >= day.targetGrams) return 'hit';
  if (eaten >= day.targetGrams - closeMarginGrams) return 'close';
  return 'missed';
}

export interface MonthSummary {
  daysHit: number;
  daysClose: number;
  daysLogged: number;
  avgEaten: number;
  bestStreak: number;
}

/**
 * Summarize a month from PAST days only — today is still in progress and
 * future days haven't happened, so neither is counted.
 *
 * `keysInMonth` must be in chronological order (as returned by monthKeys).
 * `bestStreak` is the longest run of consecutive hit-or-close days within
 * the month; an empty or missed day breaks the run.
 */
export function summarizeMonth(
  days: Map<string, Day>,
  keysInMonth: string[],
  closeMargin: number,
  todayKeyStr: string,
): MonthSummary {
  let daysHit = 0;
  let daysClose = 0;
  let daysLogged = 0;
  let eatenSum = 0;
  let bestStreak = 0;
  let run = 0;

  for (const key of keysInMonth) {
    // Date keys are zero-padded YYYY-MM-DD, so string order is date order.
    if (key >= todayKeyStr) break;
    const day = days.get(key);
    const outcome = dayOutcome(day, closeMargin);
    if (!day || outcome === 'empty') {
      run = 0;
      continue;
    }
    daysLogged += 1;
    eatenSum += eatenTotal(day);
    if (outcome === 'hit') daysHit += 1;
    if (outcome === 'close') daysClose += 1;
    if (outcome === 'hit' || outcome === 'close') {
      run += 1;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
  }

  return {
    daysHit,
    daysClose,
    daysLogged,
    avgEaten: daysLogged > 0 ? eatenSum / daysLogged : 0,
    bestStreak,
  };
}

/** Every date key of the given month, chronological. monthIndex is 0-based. */
export function monthKeys(year: number, monthIndex: number): string[] {
  const count = new Date(year, monthIndex + 1, 0).getDate();
  const keys: string[] = [];
  for (let d = 1; d <= count; d++) {
    keys.push(dateKey(new Date(year, monthIndex, d)));
  }
  return keys;
}

/** Leading blank cells before day 1 in a Monday-first calendar grid (0–6). */
export function mondayOffset(year: number, monthIndex: number): number {
  return (new Date(year, monthIndex, 1).getDay() + 6) % 7;
}
