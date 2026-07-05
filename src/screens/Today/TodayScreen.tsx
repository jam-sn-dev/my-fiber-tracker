import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { copyDay, ensureDay, setDayTarget, setEntryState } from '../../db/repo';
import { formatDayShort, todayKey, yesterdayKey } from '../../lib/dates';
import { eatenTotal, fmtG, gapGrams, parseGrams, plannedTotal } from '../../lib/fiber';
import { SLOTS, SLOT_LABELS, type Entry } from '../../types';
import Ring from '../../components/Ring';
import { useNav } from '../../nav';
import EntryOptionsSheet from './EntryOptionsSheet';
import './today.css';

const INSTALL_NUDGE_KEY = 'fibi-install-nudge-dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export default function TodayScreen() {
  const { openModal } = useNav();
  const [date, setDate] = useState<string>(() => todayKey());
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState('');
  const [optionsEntryId, setOptionsEntryId] = useState<string | null>(null);
  // Everything lives in IndexedDB, which Safari clears after ~7 days of
  // non-use unless Fibi is installed to the Home Screen — so nudge browser
  // users toward installing (dismissible, remembered).
  const [installNudge, setInstallNudge] = useState<boolean>(() => {
    try {
      return !isStandalone() && localStorage.getItem(INSTALL_NUDGE_KEY) !== '1';
    } catch {
      return false;
    }
  });

  function dismissInstallNudge() {
    setInstallNudge(false);
    try {
      localStorage.setItem(INSTALL_NUDGE_KEY, '1');
    } catch {
      // private mode etc. — dismiss for this session only
    }
  }

  // Roll the screen over at midnight: re-check the local date key when the
  // app becomes visible again and once a minute while it stays open.
  useEffect(() => {
    const check = () => setDate((prev) => (todayKey() === prev ? prev : todayKey()));
    const interval = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // Make sure a newly seen date exists (carries the current target forward).
  useEffect(() => {
    void ensureDay(date);
  }, [date]);

  const day = useLiveQuery(() => db.days.get(date), [date]);
  const yKey = yesterdayKey(date);
  const yesterday = useLiveQuery(() => db.days.get(yKey), [yKey]);

  if (!day) return <div className="screen-scroll" />;

  const target = day.targetGrams;
  const eaten = eatenTotal(day);
  const planned = plannedTotal(day);
  const gap = gapGrams(day);

  const draftNum = parseGrams(targetDraft);
  const draftValid = targetDraft.trim() !== '' && Number.isFinite(draftNum) && draftNum > 0;

  function toggleTargetEditor() {
    if (editingTarget) {
      setEditingTarget(false);
      return;
    }
    setTargetDraft(fmtG(target));
    setEditingTarget(true);
  }

  function stepTarget(delta: number) {
    const base = draftValid ? draftNum : target;
    const next = Math.max(1, Math.round((base + delta) * 10) / 10);
    setTargetDraft(fmtG(next));
  }

  function saveTarget() {
    if (!draftValid) return;
    void setDayTarget(date, Math.round(draftNum * 10) / 10);
    setEditingTarget(false);
  }

  const ringCenter =
    eaten >= target ? (
      <>
        <div className="td-ring-big">Goal met</div>
        <div className="td-ring-small">{fmtG(eaten)} g eaten</div>
      </>
    ) : gap > 0 ? (
      <>
        <div className="td-ring-big">{fmtG(gap)} g</div>
        <div className="td-ring-small">still to plan</div>
      </>
    ) : (
      <>
        <div className="td-ring-big">{fmtG(target - eaten)} g</div>
        <div className="td-ring-small">left to eat — all planned</div>
      </>
    );

  const optionsEntry = optionsEntryId
    ? day.entries.find((e) => e.id === optionsEntryId)
    : undefined;

  return (
    <div className="screen-scroll">
      <header className="td-head">
        <div>
          {/* Short form: the long weekday+month kicker wraps to two lines on
              375px screens now that three actions sit beside it. */}
          <div className="screen-kicker">{formatDayShort(date)}</div>
          <h1 className="screen-title">Today</h1>
        </div>
        <div className="td-head-actions">
          <button
            className="pill td-target-chip"
            onClick={toggleTargetEditor}
            aria-expanded={editingTarget}
          >
            Target <span className="grams">{fmtG(target)}</span> g
          </button>
          <button
            className="td-gear td-mic"
            aria-label="Voice command"
            onClick={() => openModal({ type: 'voice', date })}
          >
            🎤
          </button>
          <button
            className="td-gear"
            aria-label="Settings"
            onClick={() => openModal({ type: 'settings' })}
          >
            ⚙
          </button>
        </div>
      </header>

      {installNudge && (
        <section className="card td-install" role="note" aria-label="Install Fibi">
          <p className="small td-install-text">
            Add Fibi to your Home Screen (Share ▲ → “Add to Home Screen”) so it works offline and
            your data can’t be cleared by the browser after a week of no use.
          </p>
          <button className="btn-quiet td-install-dismiss" onClick={dismissInstallNudge}>
            Got it
          </button>
        </section>
      )}

      {editingTarget && (
        <section className="card td-target-editor" aria-label="Edit daily target">
          <div className="td-target-row">
            <button
              className="td-step"
              onClick={() => stepTarget(-1)}
              aria-label="Lower target by 1 gram"
            >
              −
            </button>
            <input
              className="td-target-input"
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              value={targetDraft}
              onChange={(e) => setTargetDraft(e.target.value)}
              aria-label="Daily target in grams"
            />
            <button
              className="td-step"
              onClick={() => stepTarget(1)}
              aria-label="Raise target by 1 gram"
            >
              +
            </button>
            <button className="btn btn-primary td-target-save" onClick={saveTarget} disabled={!draftValid}>
              Save
            </button>
          </div>
          <p className="small muted td-target-note">
            Saving also carries this target forward to future days.
          </p>
        </section>
      )}

      <section className="td-ring-wrap">
        <Ring eaten={eaten} planned={planned} target={target} size={170}>
          {ringCenter}
        </Ring>
        <div className="td-legend small muted">
          <span className="td-legend-item">
            <i className="td-dot td-dot-eaten" aria-hidden="true" /> eaten{' '}
            <span className="grams">{fmtG(eaten)}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="td-legend-item">
            <i className="td-dot td-dot-planned" aria-hidden="true" /> planned{' '}
            <span className="grams">{fmtG(planned)}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="td-legend-item">
            target <span className="grams">{fmtG(target)}</span>
          </span>
        </div>
      </section>

      {gap >= 0.5 && (
        <button
          className="btn btn-berry btn-block td-fill-gap"
          onClick={() => openModal({ type: 'fillGap', date })}
        >
          Fill the gap · suggest {fmtG(gap)} g
        </button>
      )}

      {day.entries.length === 0 && (
        <section className="card td-empty">
          <p className="td-empty-title">Nothing planned yet</p>
          {(yesterday?.entries.length ?? 0) > 0 && (
            <button className="btn btn-ghost" onClick={() => void copyDay(yKey, date)}>
              Start from yesterday
            </button>
          )}
          <p className="small muted">
            Or tap “+ Add” on any meal below — a couple of taps and the day is planned.
          </p>
        </section>
      )}

      {SLOTS.map((slot) => {
        const entries = day.entries.filter((e) => e.slot === slot);
        return (
          <section key={slot} className="card td-slot">
            <h2 className="td-slot-label">{SLOT_LABELS[slot]}</h2>
            {entries.length > 0 && (
              <div className="row-list">
                {entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    onToggle={() =>
                      void setEntryState(date, e.id, e.state === 'eaten' ? 'planned' : 'eaten')
                    }
                    onOpen={() => setOptionsEntryId(e.id)}
                  />
                ))}
              </div>
            )}
            <button
              className="td-add-row"
              onClick={() => openModal({ type: 'addEntry', date, slot })}
            >
              + Add
            </button>
          </section>
        );
      })}

      {optionsEntry && (
        <EntryOptionsSheet
          date={date}
          entry={optionsEntry}
          onClose={() => setOptionsEntryId(null)}
        />
      )}
    </div>
  );
}

function EntryRow({
  entry,
  onToggle,
  onOpen,
}: {
  entry: Entry;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const eaten = entry.state === 'eaten';
  return (
    <div className={eaten ? 'td-entry td-eaten' : 'td-entry'}>
      <button
        className="td-check"
        onClick={onToggle}
        aria-pressed={eaten}
        aria-label={eaten ? `Mark ${entry.name} as planned` : `Mark ${entry.name} as eaten`}
      >
        <span className={eaten ? 'td-check-circle td-on' : 'td-check-circle'} aria-hidden="true">
          {eaten ? '✓' : ''}
        </span>
      </button>
      <button className="td-entry-body" onClick={onOpen} aria-label={`Options for ${entry.name}`}>
        <span className="td-entry-name">
          {entry.name}
          {entry.qty !== 1 ? ` ×${fmtG(entry.qty)}` : ''}
        </span>
        <span className="grams td-entry-g">{fmtG(entry.fiberTotal)} g</span>
      </button>
    </div>
  );
}
