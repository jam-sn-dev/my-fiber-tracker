import Dexie, { type EntityTable } from 'dexie';
import type { Day, Food, Meal, Settings } from '../types';

export const db = new Dexie('fibi') as Dexie & {
  foods: EntityTable<Food, 'id'>;
  meals: EntityTable<Meal, 'id'>;
  days: EntityTable<Day, 'date'>;
  settings: EntityTable<Settings, 'id'>;
};

db.version(1).stores({
  foods: '++id, name, favorite, timesUsed, lastUsed',
  meals: '++id, name, favorite, timesUsed, lastUsed',
  days: 'date',
  settings: 'id',
});
