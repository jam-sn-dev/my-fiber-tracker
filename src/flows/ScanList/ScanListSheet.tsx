import { useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addFood } from '../../db/repo';
import { AiError, extractFoodList } from '../../lib/ai';
import { fmtG, parseGrams } from '../../lib/fiber';
import { useNav } from '../../nav';
import { DEFAULT_SETTINGS } from '../../types';
import './scanlist.css';

type Step = 'pick' | 'scanning' | 'review' | 'error' | 'done';

interface Row {
  key: string;
  checked: boolean;
  name: string;
  serving: string;
  fiber: string; // raw text, parsed with parseGrams (comma-decimal aware)
  lowConfidence: boolean;
  duplicate: boolean; // name already in the library when review opened
  fiberTouched: boolean; // she edited the fiber value → saves as 'manual'
}

function fiberOk(raw: string): boolean {
  const g = parseGrams(raw);
  return raw.trim() !== '' && Number.isFinite(g) && g >= 0;
}

function rowValid(r: Row): boolean {
  return r.name.trim() !== '' && fiberOk(r.fiber);
}

export default function ScanListSheet({ onClose }: { onClose: () => void }) {
  const { openModal } = useNav();

  // Live so that when Settings (stacked on top) saves a key and closes,
  // this sheet notices on its own — no manual re-check needed.
  const settings = useLiveQuery(async () => (await db.settings.get('app')) ?? DEFAULT_SETTINGS, []);
  const apiKey = settings?.apiKey?.trim() ?? '';

  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<AiError | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // One controller per scan attempt, so Cancel can abort the in-flight call.
  const abortRef = useRef<AbortController | null>(null);

  const checkedRows = rows.filter((r) => r.checked);
  const selectedCount = checkedRows.length;
  const allCheckedValid = checkedRows.every(rowValid);
  const totalGrams = checkedRows.reduce((sum, r) => {
    const g = parseGrams(r.fiber);
    return Number.isFinite(g) ? sum + g : sum;
  }, 0);

  function patchRow(key: string, patch: Partial<Row>) {
    setConfirmingClose(false); // she's editing again — stand down the discard prompt
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeRow(key: string) {
    setConfirmingClose(false);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  /**
   * A stray backdrop tap (or the ✕) must not destroy a reviewed list — the
   * rows live only in state. Ask first, mirroring FoodForm's inline confirm.
   */
  function guardedClose() {
    if (step === 'review' && rows.length > 0) {
      setConfirmingClose(true);
      return;
    }
    abortRef.current?.abort();
    onClose();
  }

  function cancelScan() {
    abortRef.current?.abort();
    setStep('pick');
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // let her pick the same photo again after a retake
    if (!file || !apiKey) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSaveError(null);
    setConfirmingClose(false);
    setStep('scanning');
    try {
      const ex = await extractFoodList(file, apiKey, ctrl.signal);
      if (ctrl.signal.aborted) return; // she cancelled — ignore a late result
      // Duplicate guard: names already in the library, or repeated within this
      // photo (case-insensitive exact match), start unchecked — she can
      // re-check one to add a second copy.
      const existing = new Set(
        (await db.foods.toArray()).map((f) => f.name.trim().toLowerCase()),
      );
      const seen = new Set<string>();
      setRows(
        ex.items.map((it) => {
          const norm = it.name.trim().toLowerCase();
          const duplicate = existing.has(norm) || seen.has(norm);
          seen.add(norm);
          return {
            key: crypto.randomUUID(),
            checked: !duplicate,
            name: it.name,
            serving: it.servingLabel || '1 serving',
            fiber: String(it.fiberGramsPerServing),
            lowConfidence: it.confidence === 'low',
            duplicate,
            fiberTouched: false,
          };
        }),
      );
      setNotes(ex.notes);
      setStep('review');
    } catch (err) {
      if (ctrl.signal.aborted) return; // cancelled — she's already back on 'pick'
      setError(
        err instanceof AiError
          ? err
          : new AiError('other', 'Scan failed. Try again, or add the foods one by one instead.'),
      );
      setStep('error');
    }
  }

  async function save() {
    if (busy || selectedCount === 0 || !allCheckedValid) return;
    setBusy(true);
    setSaveError(null);
    const toSave = rows.filter((r) => r.checked && rowValid(r));
    let saved = 0;
    try {
      for (const r of toSave) {
        await addFood({
          name: r.name.trim(),
          servingLabel: r.serving.trim() || '1 serving',
          fiberPerServing: parseGrams(r.fiber),
          // Honest sourcing: fiber she edited is hers ('manual'); a value she
          // left as the AI read it stays an 'estimate'.
          source: r.fiberTouched ? 'manual' : 'estimate',
          favorite: false,
        });
        // Drop the row the moment it commits, so if a later row fails a
        // retry only re-attempts the unsaved remainder — never duplicates.
        saved += 1;
        setRows((rs) => rs.filter((x) => x.key !== r.key));
      }
      setSavedCount((n) => n + saved); // running total so retries stay accurate
      setStep('done');
    } catch {
      setSavedCount((n) => n + saved);
      setSaveError(
        saved > 0
          ? `Saved ${saved} of ${toSave.length} — something went wrong. The rest are still below; tap again to retry them.`
          : 'Something went wrong and nothing was saved — tap again to retry.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Scan a list" onClose={guardedClose}>
      {settings === undefined ? null : !apiKey ? (
        <div className="sl-center">
          <div className="sl-big" aria-hidden="true">
            📝
          </div>
          <p className="sl-lead">
            Fibi can read a photo of a food list — handwritten or typed — and add every item to
            your library at once.
          </p>
          <p className="small muted">
            List scanning uses AI, which needs a one-time API key — Justin sets this up once in
            Settings. Everything else in Fibi works without it.
          </p>
          <button
            className="btn btn-primary btn-block sl-gap"
            onClick={() => openModal({ type: 'settings' })}
          >
            Open Settings
          </button>
        </div>
      ) : step === 'pick' ? (
        <div className="sl-center">
          <label className="sl-cam">
            <input type="file" accept="image/*" capture="environment" hidden onChange={handleFile} />
            <span className="sl-cam-ico" aria-hidden="true">
              📷
            </span>
            <span>Snap the list</span>
          </label>
          <label className="btn btn-ghost btn-block sl-roll">
            <input type="file" accept="image/*" hidden onChange={handleFile} />
            Choose a photo or screenshot
          </label>
          <p className="small muted">
            Handwritten, typed, or a screenshot — anything list-shaped works.
          </p>
        </div>
      ) : step === 'scanning' ? (
        <div className="sl-center sl-scanning" role="status">
          <div className="sl-spin" aria-hidden="true" />
          <p className="sl-lead">Reading the list…</p>
          <p className="small muted">This can take ~20 seconds for a long list.</p>
          <button className="btn btn-ghost btn-block sl-gap" onClick={cancelScan}>
            Cancel
          </button>
        </div>
      ) : step === 'error' && error ? (
        <div className="sl-center">
          <p className="sl-lead">{error.message}</p>
          <button
            className="btn btn-primary btn-block sl-gap"
            onClick={() => {
              setError(null);
              setStep('pick');
            }}
          >
            Try again
          </button>
          {error.kind === 'auth' && (
            <button
              className="btn btn-ghost btn-block"
              onClick={() => openModal({ type: 'settings' })}
            >
              Open Settings
            </button>
          )}
        </div>
      ) : step === 'done' ? (
        <div className="sl-center sl-done">
          <p className="sl-lead">
            Added {savedCount} {savedCount === 1 ? 'food' : 'foods'} 🎉
          </p>
          <p className="small muted">They’re in your library, ready to log any day.</p>
          <button className="btn btn-primary btn-block sl-gap" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="sl-strip sl-strip-leaf">
            Read from your photo — everything is editable, and nothing saves until you add it.
          </div>
          {notes && <div className="sl-strip sl-strip-amber">Some lines were skipped: {notes}</div>}

          {rows.length === 0 ? (
            <p className="empty-note">Nothing left from this photo — retake it, or close for now.</p>
          ) : (
            <div className="sl-rows">
              {rows.map((r) => {
                const nameMissing = r.checked && r.name.trim() === '';
                const fiberBad = r.checked && !fiberOk(r.fiber);
                return (
                  <div key={r.key} className={r.checked ? 'sl-row' : 'sl-row sl-row-dim'}>
                    <label className="sl-check">
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={(e) => patchRow(r.key, { checked: e.target.checked })}
                        aria-label={`Include ${r.name.trim() || 'this food'}`}
                      />
                    </label>
                    <div className="sl-row-main">
                      <div className="sl-line">
                        <input
                          className="sl-input sl-name"
                          value={r.name}
                          onChange={(e) => patchRow(r.key, { name: e.target.value })}
                          placeholder="Food name"
                          aria-label="Food name"
                        />
                        <button
                          className="sl-x"
                          onClick={() => removeRow(r.key)}
                          aria-label={`Remove ${r.name.trim() || 'this row'}`}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="sl-line">
                        <input
                          className="sl-input sl-serving"
                          value={r.serving}
                          onChange={(e) => patchRow(r.key, { serving: e.target.value })}
                          placeholder="1 serving"
                          aria-label="Serving"
                        />
                        <span className="sl-fiber-wrap">
                          <input
                            className="sl-input"
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            value={r.fiber}
                            onChange={(e) =>
                              patchRow(r.key, { fiber: e.target.value, fiberTouched: true })
                            }
                            placeholder="Fiber"
                            aria-label="Fiber grams per serving"
                          />
                          <span className="muted small" aria-hidden="true">
                            g
                          </span>
                        </span>
                      </div>
                      {(r.lowConfidence || r.duplicate || nameMissing || fiberBad) && (
                        <div className="sl-tags">
                          {r.lowConfidence && <span className="sl-pill-check">check me</span>}
                          {r.duplicate && <span className="muted small">already in library</span>}
                          {nameMissing && <span className="sl-err small">Needs a name</span>}
                          {fiberBad && (
                            <span className="sl-err small">Needs a fiber number (grams)</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <button
            className="btn btn-ghost btn-block sl-retake"
            onClick={() => {
              setConfirmingClose(false);
              setStep('pick');
            }}
          >
            Retake the photo
          </button>

          {rows.length > 0 && (
            <div className="sl-footer">
              {confirmingClose ? (
                <div className="sl-close-confirm">
                  <p className="small">
                    Discard {rows.length === 1 ? 'this food' : `these ${rows.length} foods`}? They
                    haven’t been added to your library.
                  </p>
                  <div className="sl-close-confirm-btns">
                    <button className="btn btn-ghost" onClick={() => setConfirmingClose(false)}>
                      Keep reviewing
                    </button>
                    <button className="btn sl-danger" onClick={onClose}>
                      Discard
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {saveError && <div className="sl-strip sl-strip-amber">{saveError}</div>}
                  <p className="sl-foot-sum">
                    {selectedCount} selected · <span className="grams">{fmtG(totalGrams)} g</span>{' '}
                    total
                  </p>
                  <button
                    className="btn btn-primary btn-block"
                    disabled={selectedCount === 0 || !allCheckedValid || busy}
                    onClick={save}
                  >
                    Add {selectedCount} {selectedCount === 1 ? 'food' : 'foods'} to library
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
