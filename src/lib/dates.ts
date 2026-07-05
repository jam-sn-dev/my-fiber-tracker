/** Local-timezone date keys (YYYY-MM-DD). Never use toISOString() for these —
 * it converts to UTC and shifts the date near midnight. */

export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return dateKey();
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function yesterdayKey(of: string = todayKey()): string {
  return addDays(of, -1);
}

/** "Saturday, July 4" */
export function formatDayLong(key: string): string {
  return keyToDate(key).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** "Sat, Jul 4" */
export function formatDayShort(key: string): string {
  return keyToDate(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
