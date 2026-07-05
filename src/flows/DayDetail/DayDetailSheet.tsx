import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { DEFAULT_SETTINGS, SLOTS, SLOT_LABELS, type Entry } from '../../types';
import { formatDayShort, todayKey } from '../../lib/dates';
import { eatenTotal, fmtG } from '../../lib/fiber';
import { dayOutcome } from '../../lib/stats';
import './day-detail.css';

/** Read-only look back at one day: totals, outcome, and what was eaten. */
export default function DayDetailSheet({ date, onClose }: { date: string; onClose: () => void }) {
  // `undefined` = still loading, `null` = no record for this date.
  const day = useLiveQuery(async () => (await db.days.get(date)) ?? null, [date]);
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const closeMargin = settings?.closeMarginGrams ?? DEFAULT_SETTINGS.closeMarginGrams;
  const title = formatDayShort(date);

  if (day === undefined) {
    return <Sheet title={title} onClose={onClose}>{null}</Sheet>;
  }

  if (day === null || day.entries.length === 0) {
    return (
      <Sheet title={title} onClose={onClose}>
        <p className="empty-note">Nothing logged this day.</p>
      </Sheet>
    );
  }

  const eaten = eatenTotal(day);
  const outcome = dayOutcome(day, closeMargin);
  const pill =
    date === todayKey()
      ? { cls: 'hs-pill-progress', label: 'In progress' }
      : outcome === 'hit'
        ? { cls: 'hs-pill-hit', label: 'Hit target' }
        : outcome === 'close'
          ? { cls: 'hs-pill-close', label: 'Close' }
          : { cls: 'hs-pill-under', label: 'Under' };

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="card hs-summary">
        <div className="hs-summary-big">
          <span className="grams">{fmtG(eaten)}</span>
          <span className="muted"> of {fmtG(day.targetGrams)} g</span>
        </div>
        <span className={`pill ${pill.cls}`}>{pill.label}</span>
      </div>

      {SLOTS.map((slot) => {
        const entries = day.entries.filter((e) => e.slot === slot);
        if (entries.length === 0) return null;
        return (
          <div className="hs-slotgroup" key={slot}>
            <div className="hs-slotname">{SLOT_LABELS[slot]}</div>
            <div className="card row-list">
              {entries.map((e) => (
                <EntryRow key={e.id} entry={e} />
              ))}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  return (
    <div className="hs-entry">
      <div className="hs-entry-name">
        {entry.name}
        {entry.qty !== 1 && <span className="muted small"> ×{entry.qty}</span>}
      </div>
      <span className="grams">{fmtG(entry.fiberTotal)} g</span>
      {entry.state === 'eaten' ? (
        <span className="hs-check" aria-label="Eaten" title="Eaten">
          ✓
        </span>
      ) : (
        <span className="hs-tag-planned">planned</span>
      )}
    </div>
  );
}
