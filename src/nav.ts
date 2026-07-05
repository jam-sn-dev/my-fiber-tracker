import { createContext, useContext } from 'react';
import type { Food, Slot } from './types';

export type Tab = 'today' | 'library' | 'history';

/**
 * Every modal flow in the app. Opened via NavContext from any screen;
 * App.tsx owns the stack (two levels deep is allowed, e.g. AddEntry → FoodForm).
 */
export type Modal =
  | { type: 'addEntry'; date: string; slot: Slot }
  | { type: 'fillGap'; date: string }
  | { type: 'foodForm'; foodId?: number; onSaved?: (food: Food) => void }
  | { type: 'scanLabel'; onSaved?: (food: Food) => void }
  | { type: 'scanList' }
  | { type: 'importLink'; onSaved?: (food: Food) => void }
  | { type: 'mealBuilder'; mealId?: number }
  | { type: 'dayDetail'; date: string }
  | { type: 'settings' };

export interface Nav {
  openModal: (m: Modal) => void;
  /** Pops the top-most modal. */
  closeModal: () => void;
}

export const NavContext = createContext<Nav>({
  openModal: () => {},
  closeModal: () => {},
});

export function useNav(): Nav {
  return useContext(NavContext);
}
