import { db } from './db';
import { SLOTS, type Day, type Food, type Meal, type Settings } from '../types';
import { ensureDay } from './repo';
import { todayKey } from '../lib/dates';

/** Shape of a Fibi backup file (version 1). */
interface BackupFile {
  version: 1;
  exportedAt: string;
  foods: Food[];
  meals: Meal[];
  days: Day[];
  settings: Settings[];
}

/**
 * Gather every table into a pretty-printed JSON file and trigger a download
 * named fibi-backup-YYYY-MM-DD.json. On iOS standalone this opens the
 * share/save flow — that's expected.
 */
export async function exportBackup(): Promise<void> {
  const [foods, meals, days, settings] = await Promise.all([
    db.foods.toArray(),
    db.meals.toArray(),
    db.days.toArray(),
    db.settings.toArray(),
  ]);

  const backup: BackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    foods,
    meals,
    days,
    settings,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fibi-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a delay: iOS needs the URL alive while the share sheet opens.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Parse + validate a backup file, then replace the entire database with its
 * contents inside one rw transaction. Returns how much was restored.
 */
export async function importBackup(
  file: File,
): Promise<{ foods: number; meals: number; days: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file couldn't be read as JSON — is it a Fibi backup?");
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error("That file doesn't look like a Fibi backup.");
  }
  const data = parsed as Partial<BackupFile>;

  if (data.version !== 1) {
    throw new Error(
      "This backup was made by a different version of Fibi, so it can't be imported here.",
    );
  }
  if (
    !Array.isArray(data.foods) ||
    !Array.isArray(data.meals) ||
    !Array.isArray(data.days) ||
    !Array.isArray(data.settings)
  ) {
    throw new Error("That file doesn't look like a Fibi backup — some of its data is missing.");
  }

  const { foods, meals, days, settings } = data;

  // Validate record shapes BEFORE any write: a truncated or hand-edited file
  // must be rejected here, not persisted where it would crash every launch.
  const allValid =
    foods.every(isValidFood) &&
    meals.every(isValidMeal) &&
    days.every(isValidDay) &&
    settings.every(isValidSettings);
  if (!allValid) {
    throw new Error("That file doesn't look like a Fibi backup — some of its data is malformed.");
  }

  await db.transaction('rw', [db.foods, db.meals, db.days, db.settings], async () => {
    await Promise.all([
      db.foods.clear(),
      db.meals.clear(),
      db.days.clear(),
      db.settings.clear(),
    ]);
    await db.foods.bulkPut(foods);
    await db.meals.bulkPut(meals);
    await db.days.bulkPut(days);
    await db.settings.bulkPut(settings);
  });

  // The backup may predate today (or come from another device), so today's
  // Day row may not exist — recreate it so the Today screen's live query
  // re-emits a valid day instead of staying blank until a restart.
  await ensureDay(todayKey());

  return { foods: foods.length, meals: meals.length, days: days.length };
}

// -------------------------------------------------------- shape validation

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidFood(v: unknown): boolean {
  return isRecord(v) && typeof v.name === 'string' && Number.isFinite(v.fiberPerServing);
}

function isValidMeal(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.name === 'string' &&
    Array.isArray(v.items) &&
    Number.isFinite(v.totalFiber)
  );
}

function isValidEntry(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Number.isFinite(v.fiberTotal) &&
    Number.isFinite(v.qty) &&
    (SLOTS as string[]).includes(v.slot as string) &&
    (v.state === 'planned' || v.state === 'eaten')
  );
}

function isValidDay(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.date === 'string' &&
    Number.isFinite(v.targetGrams) &&
    Array.isArray(v.entries) &&
    v.entries.every(isValidEntry)
  );
}

function isValidSettings(v: unknown): boolean {
  return isRecord(v) && typeof v.id === 'string' && Number.isFinite(v.currentTarget);
}
