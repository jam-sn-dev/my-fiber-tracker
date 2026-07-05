import { useEffect, useState } from 'react';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addFood, deleteFood, updateFood } from '../../db/repo';
import { parseGrams } from '../../lib/fiber';
import type { Food } from '../../types';
import './food-form.css';

export default function FoodFormSheet({
  foodId,
  onSaved,
  onClose,
}: {
  foodId?: number;
  onSaved?: (food: Food) => void;
  onClose: () => void;
}) {
  const editing = foodId != null;
  const [existing, setExisting] = useState<Food | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [serving, setServing] = useState('');
  const [fiber, setFiber] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (foodId == null) return;
    let cancelled = false;
    void db.foods.get(foodId).then((f) => {
      if (cancelled) return;
      if (!f) {
        setMissing(true);
        return;
      }
      setExisting(f);
      setName(f.name);
      setBrand(f.brand ?? '');
      setServing(f.servingLabel);
      setFiber(String(f.fiberPerServing));
      setFavorite(f.favorite);
    });
    return () => {
      cancelled = true;
    };
  }, [foodId]);

  const fiberNum = parseGrams(fiber);
  const nameOk = name.trim().length > 0;
  const servingOk = serving.trim().length > 0;
  const fiberOk = fiber.trim().length > 0 && Number.isFinite(fiberNum) && fiberNum >= 0;
  const valid = nameOk && servingOk && fiberOk;

  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const fields = {
        name: name.trim(),
        brand: brand.trim() || undefined,
        servingLabel: serving.trim(),
        fiberPerServing: fiberNum,
        favorite,
      };
      let food: Food;
      if (foodId != null && existing) {
        // Preserve the original source (manual/label/estimate/seed) on edit.
        await updateFood(foodId, fields);
        food = { ...existing, ...fields };
      } else {
        const source = 'manual' as const;
        const id = await addFood({ ...fields, source });
        food = { ...fields, source, timesUsed: 0, id };
      }
      onSaved?.(food);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (foodId == null || busy) return;
    setBusy(true);
    try {
      await deleteFood(foodId);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const title = editing ? 'Edit food' : 'New food';

  if (missing) {
    return (
      <Sheet title={title} onClose={onClose}>
        <p className="empty-note">This food isn’t in your library anymore — nothing to edit.</p>
      </Sheet>
    );
  }

  if (editing && !existing) {
    // one-shot load in flight — keep the sheet up so it doesn't flash
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="lb-ff-loading" aria-hidden="true" />
      </Sheet>
    );
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {existing?.source === 'estimate' && (
        <div className="lb-ff-note small">
          This fiber value was estimated, not read from a package — tweak it if you know better.
        </div>
      )}

      <div className="field">
        <label htmlFor="lb-ff-name">Name</label>
        <input
          id="lb-ff-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => touch('name')}
          placeholder="e.g. Rolled oats"
          autoFocus={!editing}
        />
        {touched.name && !nameOk && (
          <span className="lb-ff-err small">Give it a name so you can find it again.</span>
        )}
      </div>

      <div className="field">
        <label htmlFor="lb-ff-brand">
          Brand <span className="lb-ff-opt">optional</span>
        </label>
        <input
          id="lb-ff-brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="e.g. Bob’s Red Mill"
        />
      </div>

      <div className="field">
        <label htmlFor="lb-ff-serving">How much is one serving?</label>
        <input
          id="lb-ff-serving"
          value={serving}
          onChange={(e) => setServing(e.target.value)}
          onBlur={() => touch('serving')}
          placeholder="1 slice (45 g)"
        />
        {touched.serving && !servingOk && (
          <span className="lb-ff-err small">Describe one serving — any wording works.</span>
        )}
      </div>

      <div className="field">
        <label htmlFor="lb-ff-fiber">Fiber per serving (grams)</label>
        <input
          id="lb-ff-fiber"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          value={fiber}
          onChange={(e) => setFiber(e.target.value)}
          onBlur={() => touch('fiber')}
          placeholder="e.g. 4"
        />
        {touched.fiber && !fiberOk && (
          <span className="lb-ff-err small">Enter the fiber grams — 0 or more.</span>
        )}
      </div>

      <button
        type="button"
        className={favorite ? 'lb-ff-fav on' : 'lb-ff-fav'}
        aria-pressed={favorite}
        onClick={() => setFavorite((v) => !v)}
      >
        <span className="lb-ff-fav-star" aria-hidden="true">
          {favorite ? '★' : '☆'}
        </span>
        {favorite ? 'Favorite — shows at the top of your library' : 'Mark as a favorite'}
      </button>

      <button className="btn btn-primary btn-block lb-ff-save" disabled={!valid || busy} onClick={save}>
        {editing ? 'Save changes' : 'Save to library'}
      </button>

      {editing && !confirmingDelete && (
        <div className="lb-ff-del-row">
          <button className="btn btn-danger-quiet" onClick={() => setConfirmingDelete(true)}>
            Delete this food
          </button>
        </div>
      )}
      {editing && confirmingDelete && (
        <div className="lb-ff-confirm card">
          <p className="small">
            Past days keep their record — this only removes it from your library.
          </p>
          <div className="lb-ff-confirm-btns">
            <button className="btn btn-ghost" onClick={() => setConfirmingDelete(false)}>
              Keep it
            </button>
            <button className="btn lb-ff-danger" disabled={busy} onClick={doDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
