import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addEntry, addFood, makeFoodEntry, makeMealEntry } from '../../db/repo';
import { USDA_FOODS } from '../../db/usda-foods';
import { fmtG, parseGrams } from '../../lib/fiber';
import { useNav } from '../../nav';
import { SLOT_LABELS, type Food, type Slot } from '../../types';
import './addentry.css';

type Seg = 'foods' | 'meals';

interface RowData {
  key: string;
  favorite: boolean;
  name: string;
  brand?: string;
  sub: string;
  fiber: number; // per serving (food) or per meal
  add: (qty: number) => Promise<void>;
}

function matchesQuery(q: string, name: string, brand?: string): boolean {
  if (!q) return true;
  return `${name} ${brand ?? ''}`.toLowerCase().includes(q);
}

function librarySort<T extends { favorite: boolean; timesUsed: number; name: string }>(
  a: T,
  b: T,
): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  const useDiff = (b.timesUsed ?? 0) - (a.timesUsed ?? 0);
  if (useDiff !== 0) return useDiff;
  return a.name.localeCompare(b.name);
}

export default function AddEntrySheet({
  date,
  slot,
  onClose,
}: {
  date: string;
  slot: Slot;
  onClose: () => void;
}) {
  const { openModal } = useNav();
  const [query, setQuery] = useState('');
  const [seg, setSeg] = useState<Seg>('foods');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickFiber, setQuickFiber] = useState('');
  const [busy, setBusy] = useState(false);

  const allFoods = useLiveQuery(() => db.foods.toArray(), []);
  const allMeals = useLiveQuery(() => db.meals.toArray(), []);

  const q = query.trim().toLowerCase();
  const rows: RowData[] | undefined =
    seg === 'foods'
      ? allFoods
          ?.filter((f) => matchesQuery(q, f.name, f.brand))
          .sort(librarySort)
          .map((f) => ({
            key: `food-${f.id}`,
            favorite: f.favorite,
            name: f.name,
            brand: f.brand,
            sub: f.servingLabel,
            fiber: f.fiberPerServing,
            add: async (n: number) => {
              await addEntry(date, makeFoodEntry(f, n, slot));
            },
          }))
      : allMeals
          ?.filter((m) => matchesQuery(q, m.name))
          .sort(librarySort)
          .map((m) => ({
            key: `meal-${m.id}`,
            favorite: m.favorite,
            name: m.name,
            sub: `${m.items.length} ingredient${m.items.length === 1 ? '' : 's'}`,
            fiber: m.totalFiber,
            add: async (n: number) => {
              await addEntry(date, makeMealEntry(m, n, slot));
            },
          }));

  // Database-search lane: when she searches the Foods segment, also offer
  // matches from the bundled offline USDA generics subset that aren't in her
  // library yet. Picking one saves it to the library first (enter once,
  // reuse forever), then adds it to the slot.
  const usdaRows: RowData[] =
    seg === 'foods' && q && allFoods
      ? USDA_FOODS.filter(
          (u) =>
            matchesQuery(q, u.name) &&
            !allFoods.some((f) => f.name.toLowerCase() === u.name.toLowerCase()),
        )
          .slice(0, 20)
          .map((u) => ({
            key: `usda-${u.name}`,
            favorite: false,
            name: u.name,
            sub: u.servingLabel,
            fiber: u.fiberPerServing,
            add: async (n: number) => {
              const fields = {
                name: u.name,
                servingLabel: u.servingLabel,
                fiberPerServing: u.fiberPerServing,
                source: 'usda' as const,
                favorite: false,
              };
              const id = await addFood(fields);
              const food: Food = { ...fields, id, timesUsed: 0 };
              await addEntry(date, makeFoodEntry(food, n, slot));
            },
          }))
      : [];

  function switchSeg(next: Seg) {
    setSeg(next);
    setExpanded(null);
  }

  function toggleRow(key: string) {
    setExpanded((cur) => (cur === key ? null : key));
    setQty(1);
  }

  async function confirmAdd(row: RowData) {
    if (busy) return;
    setBusy(true);
    try {
      await row.add(qty);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function scanLabel() {
    openModal({
      type: 'scanLabel',
      onSaved: async (food) => {
        await addEntry(date, makeFoodEntry(food, 1, slot));
        // The child sheet pops itself; this pops the AddEntry picker too, so
        // she lands back on Today with the new entry visible — clear feedback
        // that the save worked (and no chance of double-adding it).
        onClose();
      },
    });
  }

  function newFood() {
    openModal({
      type: 'foodForm',
      onSaved: async (food) => {
        await addEntry(date, makeFoodEntry(food, 1, slot));
        onClose();
      },
    });
  }

  const quickFiberNum = parseGrams(quickFiber);
  // 0 g is a legitimate value (log a zero-fiber food to keep the record
  // complete) — match the FoodForm/ScanLabel validation. The trim-length
  // check keeps an empty field invalid.
  const quickValid =
    quickName.trim().length > 0 &&
    quickFiber.trim().length > 0 &&
    Number.isFinite(quickFiberNum) &&
    quickFiberNum >= 0;

  async function quickAdd() {
    if (!quickValid || busy) return;
    setBusy(true);
    try {
      await addEntry(date, {
        refType: 'food',
        name: quickName.trim(),
        fiberTotal: Math.round(quickFiberNum * 10) / 10,
        fiberPerUnit: quickFiberNum,
        qty: 1,
        slot,
        state: 'planned',
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Add to ${SLOT_LABELS[slot]}`} onClose={onClose}>
      <div className="pk-ae-search">
        <input
          type="search"
          placeholder="Search your library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
          aria-label="Search your library"
        />
      </div>

      <div className="pk-ae-seg" role="tablist" aria-label="Foods or meals">
        <button
          role="tab"
          aria-selected={seg === 'foods'}
          className={seg === 'foods' ? 'on' : ''}
          onClick={() => switchSeg('foods')}
        >
          Foods
        </button>
        <button
          role="tab"
          aria-selected={seg === 'meals'}
          className={seg === 'meals' ? 'on' : ''}
          onClick={() => switchSeg('meals')}
        >
          Meals
        </button>
      </div>

      <div className="pk-ae-actions">
        <button className="btn-quiet" onClick={scanLabel}>
          Scan a label
        </button>
        <button className="btn-quiet" onClick={newFood}>
          New food
        </button>
        <button
          className={quickOpen ? 'btn-quiet pk-ae-toggled' : 'btn-quiet'}
          aria-expanded={quickOpen}
          onClick={() => setQuickOpen((v) => !v)}
        >
          Quick add
        </button>
      </div>

      {quickOpen && (
        <div className="card pk-ae-quick">
          <div className="pk-ae-quick-row">
            <div className="field pk-ae-quick-name">
              <label htmlFor="pk-ae-quick-name-input">Name</label>
              <input
                id="pk-ae-quick-name-input"
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="e.g. Café lentil soup"
              />
            </div>
            <div className="field pk-ae-quick-fiber">
              <label htmlFor="pk-ae-quick-fiber-input">Fiber (g)</label>
              <input
                id="pk-ae-quick-fiber-input"
                inputMode="decimal"
                value={quickFiber}
                onChange={(e) => setQuickFiber(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!quickValid || busy}
            onClick={() => void quickAdd()}
          >
            Add to {SLOT_LABELS[slot]}
          </button>
          <p className="small muted pk-ae-quick-note">
            One-off entry — it won't be saved to your library.
          </p>
        </div>
      )}

      {rows && rows.length === 0 && usdaRows.length === 0 && (
        <div className="empty-note">
          {q ? (
            <>
              No matches for “{query.trim()}”.
              <br />
              “New food” or “Scan a label” above will add it in seconds.
            </>
          ) : seg === 'meals' ? (
            <>No meals yet — build one in the Library tab, or add foods one at a time.</>
          ) : (
            <>Your library is empty — “New food” or “Scan a label” above will get you going.</>
          )}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="card row-list pk-ae-list">{rows.map(renderRow)}</div>
      )}

      {usdaRows.length > 0 && (
        <>
          <p className="pk-ae-db-head small muted">From food database</p>
          <div className="card row-list pk-ae-list">{usdaRows.map(renderRow)}</div>
        </>
      )}
    </Sheet>
  );

  function renderRow(row: RowData) {
    const open = expanded === row.key;
    return (
      <div key={row.key} className={open ? 'pk-ae-item pk-ae-open' : 'pk-ae-item'}>
        <button className="pk-ae-row" onClick={() => toggleRow(row.key)} aria-expanded={open}>
          <span className="pk-ae-main">
            <span className="pk-ae-name">
              {row.favorite && (
                <span className="pk-ae-star" aria-label="Favorite">
                  ★{' '}
                </span>
              )}
              {row.name}
              {row.brand && <span className="small muted"> · {row.brand}</span>}
            </span>
            <span className="pk-ae-sub small muted">{row.sub}</span>
          </span>
          <span className="grams pk-ae-fiber">{fmtG(row.fiber)} g</span>
        </button>
        {open && (
          <div className="pk-ae-confirm">
            <div className="pk-ae-stepper">
              <button
                className="pk-ae-step"
                onClick={() => setQty((v) => Math.max(0.5, v - 0.5))}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="pk-ae-qty" aria-label="Quantity">
                {fmtG(qty)}
              </span>
              <button
                className="pk-ae-step"
                onClick={() => setQty((v) => v + 0.5)}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <span className="grams pk-ae-total">{fmtG(row.fiber * qty)} g</span>
            <button
              className="btn btn-primary pk-ae-addbtn"
              disabled={busy}
              onClick={() => void confirmAdd(row)}
            >
              Add to {SLOT_LABELS[slot]}
            </button>
          </div>
        )}
      </div>
    );
  }
}
