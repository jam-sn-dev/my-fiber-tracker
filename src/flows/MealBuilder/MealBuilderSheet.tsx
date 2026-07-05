import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addMeal, deleteMeal, updateMeal } from '../../db/repo';
import { fmtG } from '../../lib/fiber';
import { SLOTS, SLOT_LABELS, type Food, type MealItem, type Slot } from '../../types';
import { filterAndSortLibrary } from '../../lib/librarySort';
import './meal-builder.css';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export default function MealBuilderSheet({
  mealId,
  onClose,
}: {
  mealId?: number;
  onClose: () => void;
}) {
  const editing = mealId != null;
  const [ready, setReady] = useState(!editing);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [slotHint, setSlotHint] = useState<Slot | ''>('');
  const [items, setItems] = useState<MealItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mealId == null) return;
    let cancelled = false;
    void db.meals.get(mealId).then((m) => {
      if (cancelled) return;
      if (!m) {
        setMissing(true);
        return;
      }
      setName(m.name);
      setSlotHint(m.slotHint ?? '');
      setItems(m.items);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mealId]);

  // One live map over all foods: the total recomputes synchronously from state —
  // no awaiting computeMealFiber on every tap (the repo recomputes it on save).
  const allFoods = useLiveQuery(() => db.foods.toArray(), []);
  const foodById = useMemo(() => {
    const map = new Map<number, Food>();
    for (const f of allFoods ?? []) if (f.id != null) map.set(f.id, f);
    return map;
  }, [allFoods]);

  const pickerFoods = useMemo(
    () => filterAndSortLibrary(allFoods ?? [], pickerSearch),
    [allFoods, pickerSearch],
  );

  const total = items.reduce(
    (sum, it) => sum + (foodById.get(it.foodId)?.fiberPerServing ?? 0) * it.qty,
    0,
  );

  const nameOk = name.trim().length > 0;
  const valid = nameOk && items.length >= 1;

  function addIngredient(f: Food) {
    if (f.id == null) return;
    const id = f.id;
    setItems((prev) => {
      const at = prev.findIndex((it) => it.foodId === id);
      if (at >= 0) {
        // already in the meal — one more serving instead of a duplicate row
        return prev.map((it, i) => (i === at ? { ...it, qty: round1(it.qty + 1) } : it));
      }
      return [...prev, { foodId: id, qty: 1 }];
    });
    setPickerOpen(false);
    setPickerSearch('');
  }

  function stepQty(foodId: number, delta: number) {
    setItems((prev) =>
      prev.map((it) =>
        it.foodId === foodId ? { ...it, qty: Math.max(0.5, round1(it.qty + delta)) } : it,
      ),
    );
  }

  function removeItem(foodId: number) {
    setItems((prev) => prev.filter((it) => it.foodId !== foodId));
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const fields = {
        name: name.trim(),
        items,
        slotHint: slotHint === '' ? undefined : slotHint,
      };
      if (mealId != null) {
        await updateMeal(mealId, fields); // repo recomputes totalFiber
      } else {
        await addMeal({ ...fields, favorite: false });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (mealId == null || busy) return;
    setBusy(true);
    try {
      await deleteMeal(mealId);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? 'Edit meal' : 'Build a meal';

  if (missing) {
    return (
      <Sheet title={title} onClose={onClose}>
        <p className="empty-note">This meal isn’t in your library anymore — nothing to edit.</p>
      </Sheet>
    );
  }

  if (!ready) {
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="lb-mb-loading" aria-hidden="true" />
      </Sheet>
    );
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="field">
        <label htmlFor="lb-mb-name">Meal name</label>
        <input
          id="lb-mb-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setNameTouched(true)}
          placeholder="e.g. Overnight oats"
          autoFocus={!editing}
        />
        {nameTouched && !nameOk && (
          <span className="lb-mb-err small">Give the meal a name so you can reuse it.</span>
        )}
      </div>

      <div className="field">
        <label htmlFor="lb-mb-slot">Usually eaten at</label>
        <select
          id="lb-mb-slot"
          value={slotHint}
          onChange={(e) => setSlotHint(e.target.value as Slot | '')}
        >
          <option value="">—</option>
          {SLOTS.map((s) => (
            <option key={s} value={s}>
              {SLOT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <p className="screen-kicker lb-mb-sec">Ingredients</p>

      {items.length > 0 && (
        <div className="card row-list lb-mb-list">
          {items.map((it) => {
            const f = foodById.get(it.foodId);
            return (
              <div className="lb-mb-ing" key={it.foodId}>
                <div className="lb-mb-ing-info">
                  <span className="lb-mb-ing-name">
                    {f ? f.name : 'A food no longer in your library'}
                  </span>
                  {f && (
                    <span className="small muted">{fmtG(f.fiberPerServing)} g per serving</span>
                  )}
                </div>
                <div className="lb-mb-step" aria-label={`Servings of ${f?.name ?? 'ingredient'}`}>
                  <button
                    onClick={() => stepQty(it.foodId, -0.5)}
                    disabled={it.qty <= 0.5}
                    aria-label={`Fewer servings of ${f?.name ?? 'ingredient'}`}
                  >
                    −
                  </button>
                  <span className="lb-mb-qty">{fmtG(it.qty)}</span>
                  <button
                    onClick={() => stepQty(it.foodId, 0.5)}
                    aria-label={`More servings of ${f?.name ?? 'ingredient'}`}
                  >
                    +
                  </button>
                </div>
                <span className="grams lb-mb-ing-g">
                  {fmtG((f?.fiberPerServing ?? 0) * it.qty)} g
                </span>
                <button
                  className="lb-mb-x"
                  onClick={() => removeItem(it.foodId)}
                  aria-label={`Remove ${f?.name ?? 'ingredient'}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && !pickerOpen && (
        <p className="lb-mb-hint small muted">
          Pick at least one ingredient — the fiber math is on us.
        </p>
      )}

      {pickerOpen ? (
        <div className="lb-mb-picker card">
          <input
            className="lb-mb-picker-search"
            placeholder="Search your foods"
            aria-label="Search foods to add"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            autoFocus
          />
          <div className="lb-mb-picker-list row-list">
            {pickerFoods.map((f) => (
              <button key={f.id} className="lb-mb-pick-row" onClick={() => addIngredient(f)}>
                <span className="lb-mb-pick-text">
                  <span className="lb-mb-pick-name">
                    {f.favorite && (
                      <span className="lb-mb-pick-star" aria-hidden="true">
                        ★{' '}
                      </span>
                    )}
                    {f.name}
                  </span>
                  <span className="small muted lb-mb-pick-sub">
                    {[f.brand, f.servingLabel].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="grams">{fmtG(f.fiberPerServing)} g</span>
              </button>
            ))}
            {pickerFoods.length === 0 && (
              <div className="empty-note">
                No foods match — add it from the Library tab first, then come back.
              </div>
            )}
          </div>
          <button
            className="btn btn-ghost btn-block lb-mb-picker-close"
            onClick={() => {
              setPickerOpen(false);
              setPickerSearch('');
            }}
          >
            Close
          </button>
        </div>
      ) : (
        <button className="btn btn-quiet lb-mb-add" onClick={() => setPickerOpen(true)}>
          + Add an ingredient
        </button>
      )}

      <div className="lb-mb-total">
        <span>Total fiber</span>
        <span className="grams lb-mb-total-g">{fmtG(total)} g</span>
      </div>

      <button className="btn btn-primary btn-block" disabled={!valid || busy} onClick={save}>
        {editing ? 'Save changes' : 'Save meal'}
      </button>

      {editing && !confirmingDelete && (
        <div className="lb-mb-del-row">
          <button className="btn btn-danger-quiet" onClick={() => setConfirmingDelete(true)}>
            Delete this meal
          </button>
        </div>
      )}
      {editing && confirmingDelete && (
        <div className="lb-mb-confirm card">
          <p className="small">
            Past days keep their record — this only removes the meal from your library.
          </p>
          <div className="lb-mb-confirm-btns">
            <button className="btn btn-ghost" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </button>
            <button className="btn lb-mb-danger" disabled={busy} onClick={doDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
