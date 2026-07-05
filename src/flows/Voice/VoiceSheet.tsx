import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addEntry, addFood, ensureDay, makeFoodEntry, setDayTarget } from '../../db/repo';
import {
  AiError,
  parseVoiceCommand,
  type VoiceCommand,
  type VoiceContext,
  type VoicePlanItem,
} from '../../lib/ai';
import { fmtG, gapGrams, parseGrams } from '../../lib/fiber';
import { useNav } from '../../nav';
import { DEFAULT_SETTINGS, SLOT_LABELS, type Food } from '../../types';
import './voice.css';

type Mode = 'speech' | 'typed';
type Step = 'capture' | 'listening' | 'parsing' | 'confirm' | 'done' | 'error';

/** One row of the plan-confirm card. Library rows carry the resolved food;
 * new rows carry an editable fiber value (empty until she supplies one). */
type PlanRow =
  | { key: string; kind: 'library'; food: Food; name: string; qty: number }
  | { key: string; kind: 'new'; name: string; qty: number; fiberStr: string };

const EXAMPLES = [
  'Plan my breakfast for 5 g with oatmeal and berries',
  'Add green pepper to my foods — 1 g per serving',
  'I had an apple for a snack',
];

const SAVE_FAIL_NOTE = 'Hmm, that couldn’t save — tap again. Nothing gets added twice.';

/** Remembers that speech is known-broken on this device so the sheet opens in
 * typed mode next time instead of replaying the mic-failure dance. */
const VOICE_MODE_KEY = 'fibi.voiceMode';

function storedVoiceMode(): 'typed' | null {
  try {
    return localStorage.getItem(VOICE_MODE_KEY) === 'typed' ? 'typed' : null;
  } catch {
    return null;
  }
}

function persistVoiceMode(value: 'typed' | null): void {
  try {
    if (value) localStorage.setItem(VOICE_MODE_KEY, value);
    else localStorage.removeItem(VOICE_MODE_KEY);
  } catch {
    // private mode etc. — fall back to per-session behavior
  }
}

function normalizeQty(q: number): number {
  if (!Number.isFinite(q) || q <= 0) return 1;
  return Math.max(0.5, Math.round(q * 2) / 2);
}

function fiberValid(raw: string): boolean {
  const n = parseGrams(raw);
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0;
}

function rowGrams(row: PlanRow): number {
  if (row.kind === 'library') return row.food.fiberPerServing * row.qty;
  return fiberValid(row.fiberStr) ? parseGrams(row.fiberStr) * row.qty : 0;
}

/**
 * Turn the model's plan items into confirmable rows. A libraryName is only
 * trusted if it actually resolves against her library (case-insensitively);
 * otherwise the row degrades to a new-food row — never trust the model blindly.
 */
function buildRows(items: VoicePlanItem[], foods: Food[]): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const item of items) {
    const qty = normalizeQty(item.qty);
    const wanted = item.libraryName?.trim().toLowerCase();
    const match = wanted ? foods.find((f) => f.name.trim().toLowerCase() === wanted) : undefined;
    if (match) {
      rows.push({ key: crypto.randomUUID(), kind: 'library', food: match, name: match.name, qty });
      continue;
    }
    const name = (item.newFoodName ?? item.libraryName ?? '').trim();
    if (!name) continue;
    // The model may fail to set libraryName (or set one that misses) for a
    // food she already has — retry the same lookup on the fallback name so we
    // never mint a duplicate library food.
    const fallbackMatch = foods.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
    if (fallbackMatch) {
      rows.push({
        key: crypto.randomUUID(),
        kind: 'library',
        food: fallbackMatch,
        name: fallbackMatch.name,
        qty,
      });
      continue;
    }
    rows.push({
      key: crypto.randomUUID(),
      kind: 'new',
      name,
      qty,
      fiberStr: item.newFoodFiberPerServing != null ? String(item.newFoodFiberPerServing) : '',
    });
  }
  return rows;
}

async function buildVoiceContext(date: string): Promise<{ context: VoiceContext; foods: Food[] }> {
  const day = await ensureDay(date);
  const foods = await db.foods.toArray();
  return {
    foods,
    context: {
      date,
      targetGrams: day.targetGrams,
      gapGrams: gapGrams(day),
      library: foods.map((f) => ({
        name: f.name,
        fiberPerServing: f.fiberPerServing,
        servingLabel: f.servingLabel,
        favorite: f.favorite,
      })),
    },
  };
}

export default function VoiceSheet({ date, onClose }: { date: string; onClose: () => void }) {
  const { openModal } = useNav();

  // Live so that when Settings (stacked on top) saves a key and closes,
  // this sheet notices on its own — no manual re-check needed.
  const settings = useLiveQuery(async () => (await db.settings.get('app')) ?? DEFAULT_SETTINGS, []);
  const apiKey = settings?.apiKey?.trim() ?? '';

  const [mode, setMode] = useState<Mode>(() =>
    (window.SpeechRecognition ?? window.webkitSpeechRecognition) && storedVoiceMode() !== 'typed'
      ? 'speech'
      : 'typed',
  );
  const [step, setStep] = useState<Step>('capture');
  const [note, setNote] = useState<string | null>(null);
  const [typedDraft, setTypedDraft] = useState('');
  const [heard, setHeard] = useState('');
  const [transcript, setTranscript] = useState('');
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [error, setError] = useState<AiError | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');

  // add_food confirm mini-form
  const [afName, setAfName] = useState('');
  const [afServing, setAfServing] = useState('');
  const [afFiber, setAfFiber] = useState('');

  const recRef = useRef<SpeechRecognition | null>(null);
  const suppressRef = useRef(false); // ignore callbacks from an abandoned session
  const errorRoutedRef = useRef(false); // onerror already handled it; skip onend
  const heardRef = useRef('');
  const failsRef = useRef(0); // consecutive mic failures
  const watchdogRef = useRef<number | null>(null); // iOS: recognition can hang firing no events
  const abortRef = useRef<AbortController | null>(null);
  // Idempotency trackers so a failed Confirm retried never double-creates.
  const rowProgressRef = useRef<Map<string, { foodId?: number; entryDone?: boolean }>>(new Map());
  const afCreatedIdRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      suppressRef.current = true;
      if (watchdogRef.current != null) window.clearTimeout(watchdogRef.current);
      recRef.current?.stop();
      abortRef.current?.abort();
    },
    [],
  );

  // Tapping the header 🎤 should mean "talk now": once the key gate passes and
  // we're in speech mode, start listening immediately — once per open, so a
  // failure that lands back on capture doesn't restart itself in a loop.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (settings === undefined || !apiKey) return;
    if (mode !== 'speech' || step !== 'capture') return;
    autoStartedRef.current = true;
    void startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, apiKey, mode, step]);

  // ------------------------------------------------------------ live speech

  function clearWatchdog() {
    if (watchdogRef.current != null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }

  function softFail(message: string) {
    failsRef.current += 1;
    if (failsRef.current >= 2) {
      // Session-only fallback: transient hiccups (silence, a network blip)
      // must never permanently hide the mic — and the typed view offers a
      // "use the microphone" way back regardless.
      setMode('typed');
      setNote('The mic is being shy right now — the keyboard mic below works just as well.');
    } else {
      setNote(message);
    }
    setStep('capture');
  }

  /** From typed mode, back to live speech: forget any broken-mic flag and try
   * again right away (a fresh user gesture also lets the permission prompt
   * reappear where the platform allows it). */
  function retrySpeech() {
    persistVoiceMode(null);
    failsRef.current = 0;
    setNote(null);
    setMode('speech');
    void startListening();
  }

  /** The shared "mic is blocked" landing: typed mode + how to fix it. */
  function routeMicBlocked() {
    persistVoiceMode('typed');
    setMode('typed');
    setNote(
      'The mic is blocked for Fibi on this device — the keyboard mic works just as well. ' +
        'To use the in-app mic: allow the Microphone in the app’s permissions (or the browser’s site settings), then tap “use the microphone” below.',
    );
    setStep('capture');
  }

  /**
   * Android installed-PWA quirk: SpeechRecognition.start() can fail with
   * not-allowed WITHOUT ever showing a permission prompt (Chromium bug in
   * WebAPK context). getUserMedia DOES prompt correctly there, so when the
   * mic permission isn't already granted we open — and immediately close —
   * an audio stream first, purely to surface the real permission dialog.
   */
  async function ensureMicPermission(): Promise<'granted' | 'denied'> {
    try {
      const status = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      if (status.state === 'granted') return 'granted';
    } catch {
      // permissions.query unsupported here — getUserMedia below decides
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  async function startListening() {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setMode('typed');
      return;
    }
    if (recRef.current) return; // a session is already live

    suppressRef.current = false;
    setNote(null);
    setHeard('');
    heardRef.current = '';
    setStep('listening'); // shows "Listening…" while the permission settles

    const perm = await ensureMicPermission();
    if (suppressRef.current) return; // sheet closed while the prompt was up
    if (perm === 'denied') {
      routeMicBlocked();
      return;
    }

    errorRoutedRef.current = false;
    heardRef.current = '';
    setHeard('');

    const rec = new Ctor();
    rec.lang = navigator.language;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    // iOS standalone PWAs can hang after start() with no events at all — no
    // onresult, no onerror, no onend. Route that into the normal soft-fail
    // path instead of freezing on "Listening…" with a dead Done button.
    const armWatchdog = () => {
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        if (recRef.current !== rec || suppressRef.current) return;
        suppressRef.current = true;
        try {
          rec.abort();
        } catch {
          // already dead — nothing to abort
        }
        recRef.current = null;
        softFail('The mic went quiet — tap it to try again.');
      }, 9000);
    };

    rec.onresult = (ev) => {
      if (suppressRef.current) return;
      armWatchdog(); // re-arm so long dictation isn't cut off
      let text = '';
      for (let i = 0; i < ev.results.length; i += 1) {
        text += ev.results[i][0]?.transcript ?? '';
      }
      heardRef.current = text;
      setHeard(text);
    };

    rec.onerror = (ev) => {
      clearWatchdog();
      errorRoutedRef.current = true;
      recRef.current = null;
      if (suppressRef.current) return;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        routeMicBlocked();
        return;
      }
      softFail(
        ev.error === 'no-speech'
          ? 'Didn’t catch anything that time — tap the mic and try again.'
          : ev.error === 'network'
            ? 'Speech needs a connection on this device — give it another go.'
            : 'The mic hiccupped — tap it to try again.',
      );
    };

    rec.onend = () => {
      clearWatchdog();
      recRef.current = null;
      if (suppressRef.current || errorRoutedRef.current) return;
      const text = heardRef.current.trim();
      if (text) {
        failsRef.current = 0;
        persistVoiceMode(null); // speech proved itself — forget any broken flag
        void parse(text);
      } else {
        softFail('Didn’t catch anything that time — tap the mic and try again.');
      }
    };

    recRef.current = rec;
    setStep('listening');
    try {
      rec.start();
      armWatchdog();
    } catch {
      recRef.current = null;
      softFail('The mic couldn’t start — tap it to try again.');
    }
  }

  /** "Done" tap: stop() delivers the final result, then onend parses it. */
  function finishListening() {
    recRef.current?.stop();
  }

  function switchToTyped() {
    const rec = recRef.current;
    if (rec) {
      suppressRef.current = true;
      clearWatchdog();
      rec.stop();
      recRef.current = null;
      // Keep whatever she said so far — bailing to typed mid-listen is usually
      // about fixing one mis-heard word, not retyping the whole sentence.
      const partial = heardRef.current.trim();
      if (partial) setTypedDraft(partial);
    }
    setMode('typed');
    setNote(null);
    setStep('capture');
  }

  // --------------------------------------------------------------- parsing

  async function parse(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !apiKey) return;
    setTranscript(trimmed);
    setTypedDraft(trimmed); // cancel / try-again in typed mode keeps her words
    setError(null);
    setStep('parsing');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { context, foods } = await buildVoiceContext(date);
      const cmd = await parseVoiceCommand(trimmed, context, apiKey, ctrl.signal);
      if (ctrl.signal.aborted) return;
      receiveCommand(cmd, foods);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setError(
        err instanceof AiError ? err : new AiError('other', 'That didn’t go through. Try again.'),
      );
      setStep('error');
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  function cancelParse() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStep('capture');
  }

  function receiveCommand(cmd: VoiceCommand, foods: Food[]) {
    rowProgressRef.current = new Map();
    afCreatedIdRef.current = null;
    setSaveError(null);

    if (cmd.intent === 'add_food' && cmd.addFood) {
      setAfName(cmd.addFood.name);
      setAfServing(cmd.addFood.servingLabel.trim() || '1 serving');
      setAfFiber(String(cmd.addFood.fiberGramsPerServing));
      setCommand(cmd);
    } else if (cmd.intent === 'plan' && cmd.plan) {
      const built = buildRows(cmd.plan.items, foods);
      if (built.length === 0) {
        setCommand({ ...cmd, intent: 'unknown' });
      } else {
        setRows(built);
        setCommand(cmd);
      }
    } else if (
      cmd.intent === 'set_target' &&
      cmd.setTarget &&
      Number.isFinite(cmd.setTarget.grams) &&
      cmd.setTarget.grams > 0
    ) {
      setCommand(cmd);
    } else {
      setCommand({ ...cmd, intent: 'unknown' });
    }
    setStep('confirm');
  }

  function backToCapture() {
    setCommand(null);
    setError(null);
    setSaveError(null);
    setNote(null);
    setStep('capture');
  }

  function startOver() {
    setCommand(null);
    setTranscript('');
    setTypedDraft('');
    setSaveError(null);
    setNote(null);
    setStep('capture');
  }

  // ------------------------------------------------------------- executing

  const afFiberNum = parseGrams(afFiber);
  const afValid =
    afName.trim() !== '' &&
    afServing.trim() !== '' &&
    afFiber.trim() !== '' &&
    Number.isFinite(afFiberNum) &&
    afFiberNum >= 0;

  async function confirmAddFood() {
    if (!afValid || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      if (afCreatedIdRef.current == null) {
        afCreatedIdRef.current = await addFood({
          name: afName.trim(),
          servingLabel: afServing.trim(),
          fiberPerServing: afFiberNum,
          source: 'manual',
          favorite: false,
        });
      }
      setDoneMsg('Added to your library 🎉');
      setStep('done');
    } catch {
      setSaveError(SAVE_FAIL_NOTE);
    } finally {
      setBusy(false);
    }
  }

  const rowsValid =
    rows.length > 0 &&
    rows.every((r) => r.kind === 'library' || (r.name.trim() !== '' && fiberValid(r.fiberStr)));
  const planTotal = rows.reduce((sum, r) => sum + rowGrams(r), 0);
  // Once a save attempt has started (or failed partway), rowProgressRef may
  // hold persisted work — freeze row editing so a retry always replays exactly
  // the data the card shows, keeping "Nothing gets added twice" honest.
  const rowsFrozen = busy || saveError !== null;

  async function confirmPlan() {
    const plan = command?.plan;
    if (!plan || !rowsValid || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      for (const row of rows) {
        const prog = rowProgressRef.current.get(row.key) ?? {};
        let food: Food;
        if (row.kind === 'library') {
          food = row.food;
        } else {
          const fields = {
            name: row.name.trim(),
            servingLabel: '1 serving',
            fiberPerServing: parseGrams(row.fiberStr),
            source: 'manual' as const,
            favorite: false,
          };
          if (prog.foodId == null) {
            prog.foodId = await addFood(fields);
            rowProgressRef.current.set(row.key, prog);
          }
          food = { ...fields, id: prog.foodId, timesUsed: 0 };
        }
        if (!prog.entryDone) {
          // makeFoodEntry returns state 'planned'; override for "I had…".
          await addEntry(date, { ...makeFoodEntry(food, row.qty, plan.slot), state: plan.state });
          prog.entryDone = true;
          rowProgressRef.current.set(row.key, prog);
        }
      }
      setDoneMsg(
        plan.state === 'eaten'
          ? 'Logged — nice.'
          : `${SLOT_LABELS[plan.slot]} planned — ${fmtG(planTotal)} g 🎉`,
      );
      setStep('done');
    } catch {
      setSaveError(SAVE_FAIL_NOTE);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetTarget() {
    const grams = command?.setTarget?.grams;
    if (grams == null || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      await setDayTarget(date, Math.round(grams * 10) / 10);
      setDoneMsg(`Target set — ${fmtG(grams)} g a day.`);
      setStep('done');
    } catch {
      setSaveError(SAVE_FAIL_NOTE);
    } finally {
      setBusy(false);
    }
  }

  // --------------------------------------------------------------- row edits

  function stepRowQty(key: string, delta: number) {
    if (rowsFrozen) return;
    setRows((rs) =>
      rs.map((r) =>
        r.key === key ? { ...r, qty: Math.max(0.5, Math.round((r.qty + delta) * 2) / 2) } : r,
      ),
    );
  }

  function setRowFiber(key: string, value: string) {
    if (rowsFrozen) return;
    setRows((rs) => rs.map((r) => (r.key === key && r.kind === 'new' ? { ...r, fiberStr: value } : r)));
  }

  function removeRow(key: string) {
    if (rowsFrozen) return;
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  // ------------------------------------------------------------------ views

  const examples = (
    <div className="vc-examples">
      <p className="small muted vc-examples-label">Things you can say</p>
      {EXAMPLES.map((ex) => (
        <button key={ex} className="vc-chip" onClick={() => void parse(ex)}>
          “{ex}”
        </button>
      ))}
    </div>
  );

  const noteStrip = note ? (
    <p className="vc-note small" role="status">
      {note}
    </p>
  ) : null;

  const saveErrNote = saveError ? (
    <p className="vc-save-err small" role="alert">
      {saveError}
    </p>
  ) : null;

  function renderConfirm(cmd: VoiceCommand) {
    if (cmd.intent === 'add_food' && cmd.addFood) {
      return (
        <>
          <div className="vc-say">“{cmd.say}”</div>
          <div className="field">
            <label htmlFor="vc-af-name">Name</label>
            <input id="vc-af-name" value={afName} onChange={(e) => setAfName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="vc-af-serving">Serving</label>
            <input
              id="vc-af-serving"
              value={afServing}
              onChange={(e) => setAfServing(e.target.value)}
              placeholder="1 serving"
            />
          </div>
          <div className="field">
            <label htmlFor="vc-af-fiber">Fiber per serving (grams)</label>
            <input
              id="vc-af-fiber"
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={afFiber}
              onChange={(e) => setAfFiber(e.target.value)}
            />
          </div>
          {saveErrNote}
          <button
            className="btn btn-primary btn-block"
            disabled={!afValid || busy}
            onClick={() => void confirmAddFood()}
          >
            Add to library
          </button>
          <button className="btn btn-ghost btn-block vc-again" onClick={backToCapture}>
            Try again
          </button>
        </>
      );
    }

    if (cmd.intent === 'plan' && cmd.plan) {
      const plan = cmd.plan;
      return (
        <>
          <div className="vc-say">“{cmd.say}”</div>
          <div className="card vc-rows">
            {rows.map((row) => {
              const ok = row.kind === 'library' || fiberValid(row.fiberStr);
              return (
                <div key={row.key} className="vc-row">
                  <div className="vc-row-head">
                    <span className="vc-row-name">{row.name}</span>
                    {row.kind === 'new' && <span className="vc-tag-new">new</span>}
                    <button
                      className="vc-row-x"
                      onClick={() => removeRow(row.key)}
                      disabled={rowsFrozen}
                      aria-label={`Remove ${row.name}`}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="vc-row-ctrl">
                    <div className="vc-qty">
                      <button
                        className="vc-step"
                        onClick={() => stepRowQty(row.key, -0.5)}
                        disabled={rowsFrozen || row.qty <= 0.5}
                        aria-label={`Less ${row.name}`}
                      >
                        −
                      </button>
                      <span className="vc-qty-val">×{fmtG(row.qty)}</span>
                      <button
                        className="vc-step"
                        onClick={() => stepRowQty(row.key, 0.5)}
                        disabled={rowsFrozen}
                        aria-label={`More ${row.name}`}
                      >
                        +
                      </button>
                    </div>
                    {row.kind === 'new' && (
                      <div className={ok ? 'vc-fiber' : 'vc-fiber vc-fiber-ask'}>
                        <input
                          className="vc-fiber-input"
                          type="number"
                          inputMode="decimal"
                          step="0.1"
                          min="0"
                          value={row.fiberStr}
                          onChange={(e) => setRowFiber(row.key, e.target.value)}
                          disabled={rowsFrozen}
                          placeholder="?"
                          aria-label={`Fiber per serving for ${row.name}, in grams`}
                        />
                        <span className="vc-fiber-unit">g / serving</span>
                      </div>
                    )}
                    <span className="grams vc-row-g">{ok ? `${fmtG(rowGrams(row))} g` : '– g'}</span>
                  </div>
                  {row.kind === 'new' && !ok && <p className="vc-ask small">fiber per serving?</p>}
                </div>
              );
            })}
          </div>
          <div className="vc-total">
            <span>
              Total <span className="grams">{fmtG(planTotal)} g</span>
            </span>
            {plan.targetGrams != null && (
              <span className="small muted">aiming for {fmtG(plan.targetGrams)} g</span>
            )}
          </div>
          {saveErrNote}
          <button
            className="btn btn-primary btn-block"
            disabled={!rowsValid || busy}
            onClick={() => void confirmPlan()}
          >
            {plan.state === 'eaten' ? 'Log it' : `Add to ${SLOT_LABELS[plan.slot].toLowerCase()}`}
          </button>
          <button className="btn btn-ghost btn-block vc-again" onClick={backToCapture}>
            Try again
          </button>
        </>
      );
    }

    if (cmd.intent === 'set_target' && cmd.setTarget) {
      return (
        <div className="vc-center">
          <div className="vc-big" aria-hidden="true">
            🎯
          </div>
          <p className="vc-lead">
            Set today’s target to {fmtG(cmd.setTarget.grams)} g? New days will start there too.
          </p>
          {saveErrNote}
          <button
            className="btn btn-primary btn-block vc-gap"
            disabled={busy}
            onClick={() => void confirmSetTarget()}
          >
            Set target
          </button>
          <button className="btn btn-ghost btn-block" onClick={backToCapture}>
            Try again
          </button>
        </div>
      );
    }

    // unknown — show the model's clarifying question and offer another go.
    return (
      <div className="vc-center">
        <div className="vc-big" aria-hidden="true">
          🤔
        </div>
        <p className="vc-lead">
          {cmd.say?.trim() || 'I didn’t quite catch that — want to say it another way?'}
        </p>
        <button className="btn btn-primary btn-block vc-gap" onClick={backToCapture}>
          Try again
        </button>
      </div>
    );
  }

  /**
   * The confirm step holds a paid AI parse plus any hand-edits; parsing holds
   * a paid in-flight call. A stray backdrop tap must not silently discard
   * either (the unmount cleanup already aborts an in-flight parse).
   */
  function requestClose() {
    const guarded = step === 'parsing' || (step === 'confirm' && command?.intent !== 'unknown');
    if (guarded && !window.confirm('Discard this?')) return;
    onClose();
  }

  return (
    <Sheet title="Just say it" onClose={requestClose}>
      {settings === undefined ? null : !apiKey ? (
        <div className="vc-center">
          <div className="vc-big" aria-hidden="true">
            🎤
          </div>
          <p className="vc-lead">
            Tell Fibi what you ate or want to plan — she’ll line it up for a one-tap confirm.
          </p>
          <p className="small muted">
            Voice commands use AI, which needs a one-time API key — Justin sets this up once in
            Settings. Everything else in Fibi works without it.
          </p>
          <button
            className="btn btn-primary btn-block vc-gap"
            onClick={() => openModal({ type: 'settings' })}
          >
            Open Settings
          </button>
        </div>
      ) : step === 'capture' && mode === 'speech' ? (
        <div className="vc-center">
          {noteStrip}
          <button className="vc-mic" onClick={() => void startListening()} aria-label="Start listening">
            <span className="vc-mic-ico" aria-hidden="true">
              🎤
            </span>
          </button>
          <p className="vc-lead">Tap the mic and just say it</p>
          {examples}
          <button className="vc-link" onClick={switchToTyped}>
            type it instead
          </button>
        </div>
      ) : step === 'capture' ? (
        <div className="vc-typed">
          {noteStrip}
          <div className="field">
            <label htmlFor="vc-text">What would you like to do?</label>
            <textarea
              id="vc-text"
              className="vc-textarea"
              rows={3}
              value={typedDraft}
              onChange={(e) => setTypedDraft(e.target.value)}
              placeholder="Plan my lunch with a bean salad…"
            />
          </div>
          <p className="small muted vc-hint">
            Tap the 🎤 on your keyboard and just talk — no typing needed.
          </p>
          <button
            className="btn btn-primary btn-block"
            disabled={typedDraft.trim() === ''}
            onClick={() => void parse(typedDraft)}
          >
            Go
          </button>
          {(window.SpeechRecognition ?? window.webkitSpeechRecognition) != null && (
            <button className="vc-link" onClick={retrySpeech}>
              🎤 use the microphone instead
            </button>
          )}
          {examples}
        </div>
      ) : step === 'listening' ? (
        <div className="vc-center">
          <button
            className="vc-mic vc-mic-live"
            onClick={finishListening}
            aria-label="Done listening"
          >
            <span className="vc-mic-ico" aria-hidden="true">
              🎤
            </span>
          </button>
          {/* Live region scoped to the transcript only — wrapping the whole
              view would make VoiceOver re-announce the buttons on every
              interim result. */}
          <p role="status" className={heard ? 'vc-heard' : 'vc-heard vc-heard-empty'}>
            {heard || 'Listening…'}
          </p>
          <button className="btn btn-primary btn-block" onClick={finishListening}>
            Done
          </button>
          <button className="vc-link" onClick={switchToTyped}>
            type it instead
          </button>
        </div>
      ) : step === 'parsing' ? (
        <div className="vc-center vc-parsing" role="status">
          <div className="vc-spin" aria-hidden="true" />
          <p className="vc-lead">Working out what to do…</p>
          <p className="vc-quote">“{transcript}”</p>
          <button className="btn btn-ghost btn-block vc-gap" onClick={cancelParse}>
            Cancel
          </button>
        </div>
      ) : step === 'error' && error ? (
        <div className="vc-center">
          <p className="vc-lead">{error.message}</p>
          <button className="btn btn-primary btn-block vc-gap" onClick={backToCapture}>
            Retry
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
        <div className="vc-center vc-done" role="status">
          <div className="vc-big vc-check" aria-hidden="true">
            ✓
          </div>
          <p className="vc-lead">{doneMsg}</p>
          <button className="btn btn-primary btn-block vc-gap" onClick={onClose}>
            Done
          </button>
          <button className="btn btn-ghost btn-block" onClick={startOver}>
            Do another
          </button>
        </div>
      ) : step === 'confirm' && command ? (
        renderConfirm(command)
      ) : null}
    </Sheet>
  );
}
