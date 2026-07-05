import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import ConfirmDialog from '../../components/ConfirmDialog';
import { db } from '../../db/db';
import { addFood } from '../../db/repo';
import { AiError, extractMealFromUrl, extractNutritionLabel } from '../../lib/ai';
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
  // The cleaned page URL, saved with the food so she can reopen it to confirm.
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Scan-the-card-to-fill-the-link: reads the printed URL off a card photo.
  const [cardReading, setCardReading] = useState(false);
  const [cardNote, setCardNote] = useState<string | null>(null);
  // One controller per import attempt, so Cancel can abort the in-flight call.
  const abortRef = useRef<AbortController | null>(null);
  // Distinguishes a hard-deadline abort from the user tapping Cancel.
  const timedOutRef = useRef(false);

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
    timedOutRef.current = false;
    // Hard ceiling so the fetch spinner can never run away, whatever the
    // network or model does.
    const deadline = window.setTimeout(() => {
      timedOutRef.current = true;
      ctrl.abort();
    }, 65_000);
    setSourceUrl(link);
    setStep('fetching');
    try {
      const ex = await extractMealFromUrl(link, apiKey, ctrl.signal);
      if (ctrl.signal.aborted) return; // cancel/deadline handled below
      const host = new URL(link).hostname.toLowerCase();
      // Capture whatever the read gave us either way, so the no-fiber path can
      // still hand her a mostly-filled manual form (not a dead end).
      setName(ex.mealName ?? '');
      setBrand(ex.brand || (host.includes('homechef') ? 'Home Chef' : ''));
      setServing(ex.servingLabel || '1 serving');
      if (ex.fiberGramsPerServing == null) {
        setFiber('');
        setStep('nofiber');
        return;
      }
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
      // User tapped Cancel (aborted, not by the deadline): already back on input.
      if (ctrl.signal.aborted && !timedOutRef.current) return;
      setError(
        timedOutRef.current
          ? new AiError(
              'other',
              'That page is taking too long to read right now. Try again, or scan the recipe card instead.',
            )
          : err instanceof AiError
            ? err
            : new AiError('other', 'Import failed. Try again, or scan the recipe card instead.'),
      );
      setStep('error');
    } finally {
      window.clearTimeout(deadline);
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

  /** Read the printed nutrition URL off a photographed recipe card and drop it
   * into the link field, so she can just tap Import. */
  async function readCardForUrl(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !apiKey || cardReading) return;
    setCardReading(true);
    setCardNote(null);
    try {
      const ex = await extractNutritionLabel(file, apiKey);
      const found = ex.nutritionUrl?.trim();
      if (found) {
        setUrl(found);
        setCardNote('Found the link on the card — tap Import.');
      } else if (ex.fiberGramsPerServing > 0) {
        setCardNote(
          'That looks like a full nutrition panel, not a card with a link — use “Scan a label” to read it directly.',
        );
      } else {
        setCardNote('No nutrition link found on that photo. Paste the link, or use “Scan a label”.');
      }
    } catch (err) {
      setCardNote(
        err instanceof AiError ? err.message : 'Couldn’t read that photo — try again, or paste the link.',
      );
    } finally {
      setCardReading(false);
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
        // Honest sourcing: a fiber value she corrected is hers ('manual'); one
        // left as Claude read it off the webpage stays an 'estimate' — a page
        // read is not a photographed label.
        source: fiberEdited ? ('manual' as const) : ('estimate' as const),
        favorite: false,
        sourceUrl: sourceUrl || undefined,
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

          <div className="il-or">
            <span>or</span>
          </div>

          <label className={cardReading ? 'btn btn-ghost btn-block il-scan on' : 'btn btn-ghost btn-block il-scan'}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              disabled={cardReading}
              onChange={readCardForUrl}
            />
            {cardReading ? 'Reading the card…' : '📷 Scan the recipe card to fill the link'}
          </label>
          <label className="il-scan-roll small">
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={cardReading}
              onChange={readCardForUrl}
            />
            or choose a screenshot of the card
          </label>
          {cardNote && <p className="small il-card-note">{cardNote}</p>}

          <p className="small muted il-caption">
            Works with Home Chef recipe pages — the card in the box prints the link, so a photo of
            it fills the field for you.
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
          <p className="il-lead">Couldn’t read a fiber value from that page</p>
          <p className="small muted">
            Open the page to read it yourself — on Home Chef, tap “See Full Nutrition Facts” for the
            Dietary Fiber line — then enter it here.
          </p>
          {sourceUrl && (
            <a
              className="btn btn-ghost btn-block il-gap"
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              ↗ Open the page
            </a>
          )}
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              setWarn('Open the page above, read the fiber, and enter it here.');
              setTouched({});
              setStep('confirm');
            }}
          >
            Enter the fiber by hand
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
