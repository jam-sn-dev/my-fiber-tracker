import Sheet from '../../components/Sheet';
import { removeEntry, setEntryState, updateEntry } from '../../db/repo';
import { fmtG } from '../../lib/fiber';
import { SLOT_LABELS, type Entry } from '../../types';

interface EntryOptionsSheetProps {
  date: string;
  entry: Entry;
  onClose: () => void;
}

/** Options for a single day entry: eaten/planned toggle, quantity, remove. */
export default function EntryOptionsSheet({ date, entry, onClose }: EntryOptionsSheetProps) {
  const eaten = entry.state === 'eaten';

  function toggleState() {
    void setEntryState(date, entry.id, eaten ? 'planned' : 'eaten');
    onClose();
  }

  function changeQty(delta: number) {
    // Fiber per single unit from the entry's own snapshot, so library edits
    // never leak into the day's record. Prefer the exact stored per-unit
    // value; deriving it from the rounded fiberTotal (fallback for entries
    // persisted before fiberPerUnit existed) compounds rounding drift.
    const perUnit =
      entry.fiberPerUnit ?? (entry.qty > 0 ? entry.fiberTotal / entry.qty : entry.fiberTotal);
    const newQty = Math.max(0.5, Math.round((entry.qty + delta) * 2) / 2);
    if (newQty === entry.qty) return;
    void updateEntry(date, entry.id, {
      qty: newQty,
      fiberTotal: Math.round(perUnit * newQty * 10) / 10,
    });
  }

  function remove() {
    void removeEntry(date, entry.id);
    onClose();
  }

  return (
    <Sheet title={entry.name} onClose={onClose}>
      <p className="small muted td-opt-sub">
        {SLOT_LABELS[entry.slot]} · <span className="grams">{fmtG(entry.fiberTotal)}</span> g fiber
      </p>
      <div className="td-opt-actions">
        <button
          className={eaten ? 'btn btn-ghost btn-block' : 'btn btn-primary btn-block'}
          onClick={toggleState}
        >
          {eaten ? 'Move back to planned' : 'Mark as eaten'}
        </button>
        <div className="td-qty-row">
          <span className="td-qty-label">Quantity</span>
          <div className="td-qty-ctrl">
            <button
              className="td-step"
              onClick={() => changeQty(-0.5)}
              disabled={entry.qty <= 0.5}
              aria-label="Decrease quantity by one half"
            >
              −
            </button>
            <span className="td-qty-val grams">×{fmtG(entry.qty)}</span>
            <button
              className="td-step"
              onClick={() => changeQty(0.5)}
              aria-label="Increase quantity by one half"
            >
              +
            </button>
          </div>
        </div>
        <button className="btn-danger-quiet td-remove" onClick={remove}>
          Remove from today
        </button>
      </div>
    </Sheet>
  );
}
