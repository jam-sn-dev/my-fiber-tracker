import { useRef, useState, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import ConfirmDialog from '../../components/ConfirmDialog';
import { db } from '../../db/db';
import { addFood } from '../../db/repo';
import { AiError, extractMealFromUrl } from '../../lib/ai';
import { fmtG, parseGrams } from '../../lib/fiber';
import { useNav } from '../../nav';
import { DEFAULT_SETTINGS, type Food } from '../../types';
import './importlink.css';

type Step = 'input' | 'fetching' | 'confirm' | 'nofiber' | 'error';

/**
 * Does the typed text look like a web URL? Returns the normalized href
 * (https:// added if she left the scheme off), or null if it doesn't parse.
 */
function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

export default function ImportLinkSheet({
  onSaved,
  onClose,
}: {
  onSaved?: (food: Food) => void;
  onClose: () => void;
}) {
  const { openModal } = useNav();

  // Live so that when Settings (stacked on top) saves a key and closes,
  // this sheet notices on its own — no manual re-check needed.
  const settings = useLiveQuery(async () => (await db.settings.get('app')) ?? DEFAULT_SETTINGS, []);
  const apiKey = settings?.apiKey?.trim() ?? '';

  const [step, setStep] = useState<Step>('input');
  // The typed link survives every state transition, so Retry never loses it.
  const [url, setUrl] = useState('');
  const [error, setError] = useState<AiError | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [serving, setServing] = useState('');
  const [fiber, setFiber] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Did she correct the fiber value after the AI filled it? Drives sourcing.
  const [fiberEdited, setFiberEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // One controller per import attempt, so Cancel can abort the in-flight call.
  const abortRef = useRef<AbortController | null>(null);

  const canImport = normalizeUrl(url) !== null;

  const fiberNum = parseGrams(fiber);
  const nameOk = name.trim().length > 0;
  const servingOk = serving.trim().length > 0;
  const fiberOk = fiber.trim().length > 0 && Number.isFinite(fiberNum) && fiberNum >= 0;
  const valid = nameOk && servingOk && fiberOk;

  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  async function pasteLink() {
    try {
      const text = await navigator.clipboard.readText();
      const t = text.trim();
      if (t) setUrl(t);
    } catch {
      // Clipboard permission denied or unavailable — the field itself is
      // the primary path, so just do nothing and let her paste manually.
    }
  }

  async function startImport() {
    const link = normalizeUrl(url);
    if (!link || !apiKey) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStep('fetching');
    try {
      const ex = await extractMealFromUrl(link, apiKey, ctrl.signal);
      if (ctrl.signal.aborted) return; // she cancelled — ignore a late result
      if (ex.fiberGramsPerServing == null) {
        setStep('nofiber');
        return;
      }
      const host = new URL(link).hostname.toLowerCase();
      setName(ex.mealName ?? '');
      setBrand(ex.brand || (host.includes('homechef') ? 'Home Chef' : ''));
      setServing(ex.servingLabel || '1 serving');
      setFiber(fmtG(ex.fiberGramsPerServing));
      setWarn(
        ex.confidence !== 'high' || ex.notes
          ? (ex.notes ?? 'The page wasn’t fully clear — give this number a second look.')
          : null,
      );
      setTouched({});
      setFiberEdited(false);
      setStep('confirm');
    } catch (err) {
      if (ctrl.signal.aborted) return; // cancelled — she's already back on 'input'
      setError(
        err instanceof AiError
          ? err
          : new AiError('other', 'Import failed. Try again, or scan the recipe card instead.'),
      );
      setStep('error');
    }
  }

  function cancelImport() {
    abortRef.current?.abort();
    setStep('input');
  }

  function onUrlKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && canImport) {
      e.preventDefault();
      void startImport();
    }
  }

  function scanInstead() {
    // Close this sheet BEFORE opening ScanLabel: closeModal pops the
    // top-most modal, so the reverse order would pop ScanLabel itself.
    onClose();
    openModal({ type: 'scanLabel', onSaved });
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
        // Honest sourcing: a fiber value she corrected is hers ('manual'); one
        // left as Claude read it off the webpage stays an 'estimate' — a page
        // read is not a photographed label.
        source: fiberEdited ? ('manual' as const) : ('estimate' as const),
        favorite: false,
      };
      const id = await addFood(fields);
      onSaved?.({ ...fields, timesUsed: 0, id });
      onClose();
    } catch {
      // Stay on the confirm step with her values intact — the 'error' step's
      // Retry would bounce back to the URL input and discard them.
      setWarn('Couldn’t save to your library — please try again.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The confirm step holds the result of a 15–30 s paid fetch; a stray
   * backdrop tap must not silently discard it (or an in-flight fetch).
   */
  function requestClose() {
    if (step === 'confirm' || step === 'fetching') {
      setConfirmDiscard(true);
      return;
    }
    abortRef.current?.abort();
    onClose();
  }

  return (
   <>
    <Sheet title="From a link" onClose={requestClose}>
      {settings === undefined ? null : !apiKey ? (
        <div className="il-center">
          <div className="il-big" aria-hidden="true">
            🔗
          </div>
          <p className="il-lead">
            Fibi can read a recipe page from a link and fill in the meal name and fiber for you.
          </p>
          <p className="small muted">
            Link import uses AI, which needs a one-time API key — Justin sets this up once in
            Settings. Everything else in Fibi works without it.
          </p>
          <button
            className="btn btn-primary btn-block il-gap"
            onClick={() => openModal({ type: 'settings' })}
          >
            Open Settings
          </button>
        </div>
      ) : step === 'input' ? (
        <>
          <p className="il-intro">
            Paste a link to a recipe page and Fibi will read it for you.
          </p>
          <div className="field">
            <label htmlFor="il-url">Recipe link</label>
            <div className="il-url-row">
              <input
                id="il-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://www.homechef.com/meals/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={onUrlKeyDown}
              />
              <button type="button" className="btn btn-ghost il-paste" onClick={pasteLink}>
                Paste
              </button>
            </div>
          </div>
          <button
            className="btn btn-primary btn-block"
            disabled={!canImport}
            onClick={startImport}
          >
            Import
          </button>
          <p className="small muted il-caption">
            Works with Home Chef recipe pages — and most recipe sites with printed nutrition.
          </p>
        </>
      ) : step === 'fetching' ? (
        <div className="il-center il-fetching" role="status">
          <div className="il-spin" aria-hidden="true" />
          <p className="il-lead">Fetching the recipe…</p>
          <p className="small muted">
            Claude is reading the page for you — this can take 15–30 seconds.
          </p>
          <button className="btn btn-ghost btn-block il-gap" onClick={cancelImport}>
            Cancel
          </button>
        </div>
      ) : step === 'nofiber' ? (
        <div className="il-center">
          <div className="il-big" aria-hidden="true">
            🍽️
          </div>
          <p className="il-lead">That page doesn’t show a fiber value</p>
          <p className="small muted">
            Some sites hide nutrition from readers — nothing you did wrong. The recipe card in the
            box always works: scan its Nutrition Facts panel instead.
          </p>
          <button className="btn btn-primary btn-block il-gap" onClick={scanInstead}>
            Scan the recipe card
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setStep('input')}>
            Try a different link
          </button>
        </div>
      ) : step === 'error' && error ? (
        <div className="il-center">
          <p className="il-lead">{error.message}</p>
          <button
            className="btn btn-primary btn-block il-gap"
            onClick={() => {
              setError(null);
              setStep('input');
            }}
          >
            Try again
          </button>
          {error.kind !== 'auth' && (
            // The error copy points at the recipe card — give her a button
            // that actually goes there instead of making her find the lane.
            <button className="btn btn-ghost btn-block" onClick={scanInstead}>
              Scan the recipe card
            </button>
          )}
          {error.kind === 'auth' && (
            <button
              className="btn btn-ghost btn-block"
              onClick={() => openModal({ type: 'settings' })}
            >
              Open Settings
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="il-strip il-strip-leaf">
            Read from the page — check the number before saving.
          </div>
          {warn && <div className="il-strip il-strip-amber">{warn}</div>}

          <div className="field">
            <label htmlFor="il-name">Name</label>
            <input
              id="il-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => touch('name')}
              placeholder="What the recipe is called"
            />
            {touched.name && !nameOk && (
              <span className="il-err small">Give it a name so you can find it again.</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="il-brand">
              Brand <span className="il-opt">optional</span>
            </label>
            <input id="il-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="il-serving">Serving</label>
            <input
              id="il-serving"
              value={serving}
              onChange={(e) => setServing(e.target.value)}
              onBlur={() => touch('serving')}
              placeholder="1 serving"
            />
            {touched.serving && !servingOk && (
              <span className="il-err small">Describe one serving — any wording works.</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="il-fiber">Fiber per serving (grams)</label>
            <input
              id="il-fiber"
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
            />
            {touched.fiber && !fiberOk && (
              <span className="il-err small">Enter the fiber grams — 0 or more.</span>
            )}
          </div>

          <button className="btn btn-primary btn-block" disabled={!valid || busy} onClick={save}>
            Save to library
          </button>
          <button className="btn btn-ghost btn-block il-again" onClick={() => setStep('input')}>
            Try a different link
          </button>
        </>
      )}
    </Sheet>
    {confirmDiscard && (
      <ConfirmDialog
        title="Discard this recipe?"
        message="The imported details haven’t been saved to your library yet."
        confirmLabel="Discard"
        cancelLabel="Keep it"
        danger
        onConfirm={() => {
          setConfirmDiscard(false);
          abortRef.current?.abort();
          onClose();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    )}
   </>
  );
}
