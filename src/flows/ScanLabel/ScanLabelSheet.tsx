import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addFood } from '../../db/repo';
import { AiError, extractMealFromUrl, extractNutritionLabel } from '../../lib/ai';
import { parseGrams } from '../../lib/fiber';
import { useNav } from '../../nav';
import { DEFAULT_SETTINGS, type Food } from '../../types';
import './scan-label.css';

type Step = 'pick' | 'scanning' | 'chasing' | 'confirm' | 'error';

/** Printed URLs usually omit the scheme ("www.homechef.com/53562"). */
function withScheme(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export default function ScanLabelSheet({
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

  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState<AiError | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [serving, setServing] = useState('');
  const [fiber, setFiber] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  // Recipe-card chase: the photo carried a nutrition URL instead of a panel.
  const [chaseHost, setChaseHost] = useState('');
  const [chased, setChased] = useState(false);
  const [chaseUrl, setChaseUrl] = useState(''); // saved with the food to reopen
  const [fiberEdited, setFiberEdited] = useState(false);
  const chaseAbort = useRef<AbortController | null>(null);

  useEffect(() => () => chaseAbort.current?.abort(), []);

  const fiberNum = parseGrams(fiber);
  const nameOk = name.trim().length > 0;
  const servingOk = serving.trim().length > 0;
  const fiberOk = fiber.trim().length > 0 && Number.isFinite(fiberNum) && fiberNum >= 0;
  const valid = nameOk && servingOk && fiberOk;

  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // let her pick the same photo again after a retake
    if (!file || !apiKey) return;
    setStep('scanning');
    setChased(false);
    setFiberEdited(false);
    try {
      const ex = await extractNutritionLabel(file, apiKey);

      // Meal-kit card: no fiber on the photo, but a printed nutrition URL —
      // follow it (Home Chef cards say "View nutritional information at …").
      if (ex.nutritionUrl && ex.fiberGramsPerServing <= 0) {
        await chaseNutritionUrl(ex);
        return;
      }

      // Join productName + brand sensibly: name gets the product name,
      // falling back to the brand alone if that's all the label showed.
      setName(ex.productName ?? ex.brand ?? '');
      setBrand(ex.productName ? (ex.brand ?? '') : '');
      setServing(ex.servingLabel ?? '');
      setFiber(String(ex.fiberGramsPerServing));
      setWarn(
        ex.confidence !== 'high' || ex.notes
          ? (ex.notes ?? 'The photo wasn’t fully clear — give these numbers a second look.')
          : null,
      );
      setTouched({});
      setStep('confirm');
    } catch (err) {
      setError(
        err instanceof AiError
          ? err
          : new AiError('other', 'Scan failed. Try again, or type the food in instead.'),
      );
      setStep('error');
    }
  }

  /** The photo pointed at a nutrition page — fetch it and prefill the card. */
  async function chaseNutritionUrl(ex: {
    productName: string | null;
    brand: string | null;
    nutritionUrl: string | null;
  }) {
    const url = withScheme(ex.nutritionUrl!);
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      host = 'the linked page';
    }
    const cardName = ex.productName ?? '';
    const cardBrand = ex.brand ?? (host.includes('homechef') ? 'Home Chef' : '');
    setChaseHost(host);
    setChaseUrl(url);
    setChased(true);
    setStep('chasing');

    const ctrl = new AbortController();
    chaseAbort.current = ctrl;
    try {
      const r = await extractMealFromUrl(url, apiKey, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setName(r.mealName ?? cardName);
      setBrand(r.brand ?? cardBrand);
      setServing(r.servingLabel || '1 serving');
      if (r.fiberGramsPerServing != null) {
        setFiber(String(r.fiberGramsPerServing));
        setWarn(
          r.confidence !== 'high' || r.notes
            ? (r.notes ?? 'Give the number a quick look before saving.')
            : null,
        );
      } else {
        setFiber('');
        setWarn(`${host} didn’t show a fiber value for this meal — type it in below.`);
      }
      setTouched({});
      setStep('confirm');
    } catch (err) {
      if (ctrl.signal.aborted) return;
      // Don't dead-end: she's holding the card — open the confirm form with
      // what the photo gave us and let her fill the fiber in herself.
      setName(cardName);
      setBrand(cardBrand);
      setServing('1 serving');
      setFiber('');
      setWarn(
        `The card links to ${host}, but the page couldn’t be read just now${
          err instanceof AiError ? ` (${err.message.replace(/\.$/, '').toLowerCase()})` : ''
        }. Type the fiber in below, or retake to try again.`,
      );
      setTouched({});
      setStep('confirm');
    } finally {
      if (chaseAbort.current === ctrl) chaseAbort.current = null;
    }
  }

  function cancelChase() {
    chaseAbort.current?.abort();
    setStep('pick');
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
        // A value read straight off a printed panel is label-grade; one that
        // was derived from a linked nutrition page stays an estimate unless
        // she typed her own number.
        source: chased ? (fiberEdited ? ('manual' as const) : ('estimate' as const)) : ('label' as const),
        favorite: false,
        // Keep the page we followed so she can reopen it to confirm the value.
        sourceUrl: chased && chaseUrl ? chaseUrl : undefined,
      };
      const id = await addFood(fields);
      onSaved?.({ ...fields, timesUsed: 0, id });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Scan a label" onClose={onClose}>
      {settings === undefined ? null : !apiKey ? (
        <div className="lb-sc-center">
          <div className="lb-sc-big" aria-hidden="true">
            📷
          </div>
          <p className="lb-sc-lead">
            Fibi can read a photo of a Nutrition Facts panel and fill the numbers in for you.
          </p>
          <p className="small muted">
            Label scanning uses AI, which needs a one-time API key — Justin sets this up once in
            Settings. Everything else in Fibi works without it.
          </p>
          <button
            className="btn btn-primary btn-block lb-sc-gap"
            onClick={() => openModal({ type: 'settings' })}
          >
            Open Settings
          </button>
        </div>
      ) : step === 'pick' ? (
        <div className="lb-sc-center">
          <label className="lb-sc-cam">
            <input type="file" accept="image/*" capture="environment" hidden onChange={handleFile} />
            <span className="lb-sc-cam-ico" aria-hidden="true">
              📷
            </span>
            <span>Snap the Nutrition Facts panel</span>
          </label>
          <label className="btn btn-ghost btn-block lb-sc-roll">
            <input type="file" accept="image/*" hidden onChange={handleFile} />
            Choose from photos
          </label>
          <p className="small muted">
            Works on screenshots too — and on meal-kit recipe cards: if the card prints a
            nutrition link (Home Chef does), Fibi follows it for you.
          </p>
        </div>
      ) : step === 'chasing' ? (
        <div className="lb-sc-center lb-sc-scanning" role="status">
          <div className="lb-sc-spin" aria-hidden="true" />
          <p className="lb-sc-lead">The card links to {chaseHost} — reading the nutrition page…</p>
          <p className="small muted">Usually 15–30 seconds.</p>
          <button className="btn btn-ghost btn-block lb-sc-gap" onClick={cancelChase}>
            Cancel
          </button>
        </div>
      ) : step === 'scanning' ? (
        <div className="lb-sc-center lb-sc-scanning" role="status">
          <div className="lb-sc-spin" aria-hidden="true" />
          <p className="lb-sc-lead">Reading the label…</p>
          <p className="small muted">Usually just a few seconds.</p>
        </div>
      ) : step === 'error' && error ? (
        <div className="lb-sc-center">
          <p className="lb-sc-lead">{error.message}</p>
          <button
            className="btn btn-primary btn-block lb-sc-gap"
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
      ) : (
        <>
          <div className="lb-sc-strip lb-sc-strip-leaf">
            {chased
              ? `Read from the card’s nutrition page (${chaseHost}) — check the numbers before saving.`
              : 'Read from your photo — check the numbers before saving.'}
          </div>
          {warn && <div className="lb-sc-strip lb-sc-strip-amber">{warn}</div>}

          <div className="field">
            <label htmlFor="lb-sc-name">Name</label>
            <input
              id="lb-sc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => touch('name')}
              placeholder="What the package calls it"
            />
            {touched.name && !nameOk && (
              <span className="lb-sc-err small">Give it a name so you can find it again.</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="lb-sc-brand">
              Brand <span className="lb-sc-opt">optional</span>
            </label>
            <input id="lb-sc-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="lb-sc-serving">Serving</label>
            <input
              id="lb-sc-serving"
              value={serving}
              onChange={(e) => setServing(e.target.value)}
              onBlur={() => touch('serving')}
              placeholder="1 slice (45 g)"
            />
            {touched.serving && !servingOk && (
              <span className="lb-sc-err small">Describe one serving — any wording works.</span>
            )}
          </div>

          <div className="field">
            <label htmlFor="lb-sc-fiber">Fiber per serving (grams)</label>
            <input
              id="lb-sc-fiber"
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
              <span className="lb-sc-err small">Enter the fiber grams — 0 or more.</span>
            )}
          </div>

          <button className="btn btn-primary btn-block" disabled={!valid || busy} onClick={save}>
            Save to library
          </button>
          <button className="btn btn-ghost btn-block lb-sc-retake" onClick={() => setStep('pick')}>
            Retake
          </button>
        </>
      )}
    </Sheet>
  );
}
