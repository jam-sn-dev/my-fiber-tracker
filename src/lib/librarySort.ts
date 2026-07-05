/**
 * Library ordering + search, shared by LibraryScreen and the MealBuilder
 * ingredient picker so both lists always feel the same.
 * Order: favorites first, then most-used, then A→Z.
 */

interface LibraryItem {
  name: string;
  brand?: string;
  favorite: boolean;
  timesUsed: number;
}

export function compareLibraryItems(a: LibraryItem, b: LibraryItem): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  const usedA = a.timesUsed ?? 0;
  const usedB = b.timesUsed ?? 0;
  if (usedA !== usedB) return usedB - usedA;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Case-insensitive substring match on name + brand. Empty query matches all. */
export function matchesLibrarySearch(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  return (item.brand ?? '').toLowerCase().includes(q);
}

export function filterAndSortLibrary<T extends LibraryItem>(items: T[], query: string): T[] {
  return items.filter((i) => matchesLibrarySearch(i, query)).sort(compareLibraryItems);
}
