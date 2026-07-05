import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { getSettings, updateSettings } from '../../db/repo';
import { exportBackup, importBackup } from '../../db/backup';
import { fmtG } from '../../lib/fiber';
import './settings.css';

const APP_VERSION = '0.1.0';

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'));

  // Make sure the settings row exists so the live query has something to show.
  useEffect(() => {
    void getSettings();
  }, []);

  return (
    <Sheet title="Settings" onClose={onClose}>
      {settings ? (
        <div className="st-settings">
          <TargetSection target={settings.currentTarget} />
          <ApiKeySection apiKey={settings.apiKey} />
          <MarginSection margin={settings.closeMarginGrams} />
          <DataSection />
          <AboutSection />
        </div>
      ) : null}
    </Sheet>
  );
}

// ------------------------------------------------------------ daily target

function TargetSection({ target }: { target: number }) {
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (n: number) => Math.min(80, Math.max(1, Math.round(n * 2) / 2));

  const commit = () => {
    if (draft !== null) {
      const n = parseFloat(draft);
      if (!Number.isNaN(n) && n > 0) void updateSettings({ currentTarget: clamp(n) });
    }
    setDraft(null);
  };

  const nudge = (delta: number) => {
    setDraft(null);
    void updateSettings({ currentTarget: clamp(target + delta) });
  };

  return (
    <section className="st-section">
      <div className="screen-kicker st-label">Daily target</div>
      <div className="st-stepper">
        <button
          className="st-step-btn"
          onClick={() => nudge(-1)}
          disabled={target <= 1}
          aria-label="Lower the daily target"
        >
          −
        </button>
        <input
          className="st-target-input"
          type="number"
          inputMode="decimal"
          step="any"
          min={1}
          value={draft ?? fmtG(target)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Daily fiber target in grams"
        />
        <span className="st-unit">g</span>
        <button
          className="st-step-btn"
          onClick={() => nudge(1)}
          disabled={target >= 80}
          aria-label="Raise the daily target"
        >
          +
        </button>
      </div>
      <p className="st-caption">
        New days start with this target. You can still change any single day from the Today
        screen.
      </p>
    </section>
  );
}

// ------------------------------------------------------- label scanning key

function ApiKeySection({ apiKey }: { apiKey?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const skipBlurSave = useRef(false);

  const hasKey = typeof apiKey === 'string' && apiKey.length > 0;
  const showInput = editing || !hasKey;

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed) void updateSettings({ apiKey: trimmed });
    setDraft('');
    setEditing(false);
  };

  const onBlur = () => {
    if (skipBlurSave.current) {
      skipBlurSave.current = false;
      return;
    }
    if (draft.trim()) save();
  };

  const cancel = () => {
    setDraft('');
    setEditing(false);
  };

  const removeKey = () => {
    void updateSettings({ apiKey: undefined });
    setDraft('');
    setEditing(false);
  };

  return (
    <section className="st-section">
      <div className="screen-kicker st-label">Label scanning (AI)</div>

      {!showInput && (
        <>
          <div className="st-key-status">
            <span className="pill">✓ Ready to scan</span>
            <span className="st-masked muted small">sk-ant-••••••••</span>
          </div>
          <div className="st-key-actions">
            <button className="btn-quiet st-touch" onClick={() => setEditing(true)}>
              Replace
            </button>
            <button className="btn-danger-quiet st-touch" onClick={removeKey}>
              Remove key
            </button>
          </div>
        </>
      )}

      {showInput && (
        <div className="st-key-row">
          <input
            className="st-key-input"
            type="password"
            placeholder="sk-ant-…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={onBlur}
            aria-label="Anthropic API key"
          />
          <button className="btn btn-primary" onClick={save} disabled={!draft.trim()}>
            Save
          </button>
          {hasKey && (
            <button
              className="btn-quiet st-touch"
              onPointerDown={() => {
                skipBlurSave.current = true;
              }}
              onClick={cancel}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <p className="st-caption">
        Used only to read nutrition labels you photograph. The key and all your data stay on
        this phone.
      </p>
    </section>
  );
}

// ---------------------------------------------------------- close counts as

function MarginSection({ margin }: { margin: number }) {
  const nudge = (delta: number) => {
    const next = Math.min(5, Math.max(0, Math.round((margin + delta) * 2) / 2));
    void updateSettings({ closeMarginGrams: next });
  };

  return (
    <section className="st-section">
      <div className="screen-kicker st-label">Close counts as</div>
      <div className="st-stepper">
        <button
          className="st-step-btn"
          onClick={() => nudge(-0.5)}
          disabled={margin <= 0}
          aria-label="Narrow the close margin"
        >
          −
        </button>
        <div className="st-stepper-value">
          <span className="grams">{fmtG(margin)} g</span>
        </div>
        <button
          className="st-step-btn"
          onClick={() => nudge(0.5)}
          disabled={margin >= 5}
          aria-label="Widen the close margin"
        >
          +
        </button>
      </div>
      <p className="st-caption">
        History marks a day 'close' when you land within this many grams of the target.
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ backups

type DataNote = { kind: 'ok' | 'err'; text: string };

function DataSection() {
  const [note, setNote] = useState<DataNote | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setNote(null);
    try {
      await exportBackup();
      setNote({ kind: 'ok', text: 'Backup saved — stash it somewhere safe.' });
    } catch {
      setNote({ kind: 'err', text: "Couldn't create the backup. Give it another try." });
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-picking the same file later
    if (file) {
      setPending(file);
      setNote(null);
    }
  };

  const onConfirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const counts = await importBackup(pending);
      setNote({
        kind: 'ok',
        text: `All set — restored ${counts.foods} foods, ${counts.meals} meals, and ${counts.days} days.`,
      });
    } catch (err) {
      setNote({
        kind: 'err',
        text: err instanceof Error ? err.message : "Couldn't read that backup file.",
      });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <section className="st-section">
      <div className="screen-kicker st-label">Your data</div>

      <div className="st-data-btns">
        <button className="btn btn-ghost btn-block" onClick={() => void onExport()}>
          Export backup
        </button>
        <label className="btn btn-ghost btn-block">
          Import backup
          <input
            className="st-hidden"
            type="file"
            accept=".json,application/json"
            onChange={onPick}
          />
        </label>
      </div>

      {pending && (
        <div className="card st-confirm">
          <p className="st-confirm-text">
            This replaces everything currently in the app with the backup{' '}
            <strong>{pending.name}</strong>.
          </p>
          <div className="st-confirm-btns">
            <button className="btn btn-ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
            <button className="btn st-btn-danger" onClick={() => void onConfirmImport()} disabled={busy}>
              {busy ? 'Importing…' : 'Replace & import'}
            </button>
          </div>
        </div>
      )}

      {note && (
        <div className={`st-note ${note.kind === 'ok' ? 'st-note-ok' : 'st-note-err'}`} role="status">
          {note.text}
        </div>
      )}

      <p className="st-caption">
        Everything lives on this phone only — export a backup every now and then.
      </p>
    </section>
  );
}

// -------------------------------------------------------------------- about

function AboutSection() {
  const [standalone] = useState(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );

  return (
    <section className="st-section">
      <div className="screen-kicker st-label">About</div>
      <div className="card st-about">
        <span className="st-app-name">Fibi</span>
        <span className="muted small">Version {APP_VERSION}</span>
      </div>
      {!standalone && (
        <div className="st-install">
          Add Fibi to your Home Screen: tap Share ▲ then 'Add to Home Screen' — it becomes a
          real app, works offline.
        </div>
      )}
    </section>
  );
}
