import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addFood, deleteFood, updateFood } from '../../db/repo';
import { AiError, lookupFoodFiber } from '../../lib/ai';
import { parseGrams } from '../../lib/fiber';
import { useNav } from '../../nav';
import { DEFAULT_SETTINGS, type Food } from '../../types';
import './food-form.css';

type Mode = 'auto' | 'manual';
type LookStep = 'idle' | 'looking' | 'done' | 'error';

export default function FoodFormSheet({
  foodId,
  initialName,
  onSaved,
  onClose,
}: {
  foodId?: number;
  initialName?: string;
  onSaved?: (food: Food) => void;
  onClose: () => void;
}) {
  const { openModal } = useNav();
  const editing = foodId != null;

  const settings = useLiveQuery(async () => (await db.settings.get('app')) ?? DEFAULT_SETTINGS, []);
  const apiKey = settings?.apiKey?.trim() ?? '';

  const [existing, setExisting] = useState<Food | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState(initialName ?? '');
  const [brand, setBrand] = useState('');
  const [serving, setServing] = useState('');
  const [fiber, setFiber] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Auto (AI) vs manual entry — new foods only. Editing is always the plain
  // form. Auto is the default when a key is set; without one, manual.
  const [mode, setMode] = useState<Mode>('manual');
  const [lookStep, setLookStep] = useState<LookStep>('idle');
  const [lookErr, setLookErr] = useState<AiError | null>(null);
  const [lookNote, setLookNote] = useState<string | null>(null);
  const [lookedUp, setLookedUp] = useState(false); // AI produced the value
  const [fiberEdited, setFiberEdited] = useState(false); // she changed it after

  // Pick the default mode once settings resolve (auto when a key exists).
  const [modeInit, setModeInit] = useState(false);
  useEffect(() => {
    if (editing || modeInit || settings === undefined) return;
    setMode(apiKey ? 'auto' : 'manual');
    setModeInit(true);
  }, [editing, modeInit, settings, apiKey]);

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

  // Whether to show the full field set. Manual mode always; auto mode only
  // once the lookup has produced values to review.
  const showFields = editing || mode === 'manual' || lookedUp;

  async function runLookup() {
    if (!nameOk || lookStep === 'looking') return;
    if (!apiKey) {
      setLookStep('error');
      setLookErr(new AiError('auth', 'Auto-fill uses AI — add a one-time API key in Settings.'));
      return;
    }
    setLookErr(null);
    setLookStep('looking');
    try {
      const r = await lookupFoodFiber(name.trim(), apiKey);
      setName(r.name || name.trim());
      setServing(r.servingLabel);
      // A branded/unknown item comes back known=false — leave fiber blank so
      // she types it rather than saving a fabricated 0.
      setFiber(r.known ? String(r.fiberGramsPerServing) : '');
      setFiberEdited(false);
      setLookedUp(true);
      setLookNote(
        r.known
          ? (r.note ?? null)
          : (r.note ??
              'This looks like a branded item — its fiber varies by brand, so type it from the package.'),
      );
      setLookStep('done');
    } catch (err) {
      setLookErr(err instanceof AiError ? err : new AiError('other', 'Lookup failed. Try again.'));
      setLookStep('error');
    }
  }

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
        // An AI-filled value she didn't change is an estimate; a value she
        // typed or corrected is her own manual entry.
        const source = lookedUp && !fiberEdited ? ('estimate' as const) : ('manual' as const);
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
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="lb-ff-loading" aria-hidden="true" />
      </Sheet>
    );
  }

  function switchMode(next: Mode) {
    setMode(next);
    setLookStep('idle');
    setLookErr(null);
    setLookNote(null);
    // Switching to a fresh manual entry shouldn't carry an AI value's flags.
    if (next === 'manual') {
      setLookedUp(false);
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {!editing && (
        <div className="lb-ff-modes" role="tablist" aria-label="How to add this food">
          <button
            role="tab"
            aria-selected={mode === 'auto'}
            className={mode === 'auto' ? 'on' : ''}
            onClick={() => switchMode('auto')}
          >
            🔎 Auto
          </button>
          <button
            role="tab"
            aria-selected={mode === 'manual'}
            className={mode === 'manual' ? 'on' : ''}
            onClick={() => switchMode('manual')}
          >
            ✏️ Manual
          </button>
        </div>
      )}

      {!editing && mode === 'auto' && (
        <p className="small muted lb-ff-mode-note">
          Type a food and Fibi looks up a typical serving and its fiber — you review it before
          saving.
        </p>
      )}

      {existing?.source === 'estimate' && (
        <div className="lb-ff-note small">
          This fiber value was estimated, not read from a package — tweak it if you know better.
        </div>
      )}

      {existing?.sourceUrl && (
        <a
          className="lb-ff-src small"
          href={existing.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          ↗ Open the source page to confirm this fiber
        </a>
      )}

      <div className="field">
        <label htmlFor="lb-ff-name">Name</label>
        <input
          id="lb-ff-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => touch('name')}
          placeholder="e.g. Bell pepper"
          autoFocus={!editing && !initialName}
        />
        {touched.name && !nameOk && (
          <span className="lb-ff-err small">Give it a name so you can find it again.</span>
        )}
      </div>

      {/* Auto mode, before a value exists: the look-up control lives here. */}
      {!editing && mode === 'auto' && !lookedUp && (
        <div className="lb-ff-lookup">
          {lookStep === 'looking' ? (
            <div className="lb-ff-looking" role="status">
              <span className="lb-ff-spin" aria-hidden="true" />
              Looking up “{name.trim()}”…
            </div>
          ) : lookStep === 'error' && lookErr ? (
            <>
              <p className="lb-ff-err small">{lookErr.message}</p>
              {lookErr.kind === 'auth' ? (
                <button
                  className="btn btn-primary btn-block"
                  onClick={() => openModal({ type: 'settings' })}
                >
                  Open Settings
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-block"
                  disabled={!nameOk}
                  onClick={() => void runLookup()}
                >
                  Try again
                </button>
              )}
            </>
          ) : (
            <button
              className="btn btn-primary btn-block"
              disabled={!nameOk}
              onClick={() => void runLookup()}
            >
              🔎 Look up the fiber
            </button>
          )}
          <button className="lb-ff-switch" onClick={() => switchMode('manual')}>
            enter it manually instead
          </button>
        </div>
      )}

      {lookedUp && lookNote && <div className="lb-ff-note small">{lookNote}</div>}
      {lookedUp && !lookNote && (
        <div className="lb-ff-info small">AI estimate — check the numbers before saving.</div>
      )}

      {showFields && (
        <>
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
              onChange={(e) => {
                setFiber(e.target.value);
                setFiberEdited(true);
              }}
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

          <button
            className="btn btn-primary btn-block lb-ff-save"
            disabled={!valid || busy}
            onClick={save}
          >
            {editing ? 'Save changes' : 'Save to library'}
          </button>
        </>
      )}

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
