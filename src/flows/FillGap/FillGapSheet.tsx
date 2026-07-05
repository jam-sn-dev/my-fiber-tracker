import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { addEntry } from '../../db/repo';
import { fmtG, gapGrams } from '../../lib/fiber';
import { suggestForGap, type Suggestion } from '../../lib/recommend';
import { SLOT_LABELS } from '../../types';
import './fillgap.css';

const PAGE = 4;

export default function FillGapSheet({ date, onClose }: { date: string; onClose: () => void }) {
  // undefined = still loading, null = day row doesn't exist yet
  const day = useLiveQuery(async () => (await db.days.get(date)) ?? null, [date]);
  const settings = useLiveQuery(() => db.settings.get('app'), []);

  const gap =
    day === undefined
      ? undefined
      : day !== null
        ? gapGrams(day)
        : settings !== undefined
          ? Math.max(0, settings.currentTarget)
          : undefined;

  const [sugs, setSugs] = useState<Suggestion[] | null>(null);
  const [busyTitle, setBusyTitle] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const shownRef = useRef<Set<string>>(new Set());
  const addedRef = useRef<Set<string>>(new Set());

  // Recompute suggestions whenever the live gap changes (e.g. after an add).
  useEffect(() => {
    if (gap === undefined) return;
    if (gap <= 0) {
      setSugs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const added = addedRef.current;
      const list = await suggestForGap(date, added.size + PAGE);
      if (cancelled) return;
      const fresh = list.filter((s) => !added.has(s.title)).slice(0, PAGE);
      for (const s of fresh) shownRef.current.add(s.title);
      setSugs(fresh);
      setExhausted(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [date, gap]);

  async function handleAdd(s: Suggestion) {
    if (busyTitle !== null) return;
    setBusyTitle(s.title);
    try {
      for (const e of s.entries) {
        await addEntry(date, e);
      }
      addedRef.current.add(s.title);
      // Remove the card; the sheet stays open and the gap header updates live.
      setSugs((prev) => (prev ? prev.filter((x) => x.title !== s.title) : prev));
    } finally {
      setBusyTitle(null);
    }
  }

  async function moreIdeas() {
    if (rolling) return;
    setRolling(true);
    try {
      const exclude = new Set<string>([...shownRef.current, ...addedRef.current]);
      const list = await suggestForGap(date, exclude.size + PAGE);
      const fresh = list.filter((s) => !exclude.has(s.title)).slice(0, PAGE);
      if (fresh.length === 0) {
        setExhausted(true);
        return;
      }
      for (const s of fresh) shownRef.current.add(s.title);
      setSugs(fresh);
      setExhausted(false);
    } finally {
      setRolling(false);
    }
  }

  return (
    <Sheet title="Fill the gap" onClose={onClose}>
      {gap === undefined ? (
        <p className="small muted pk-fg-loading">Loading your day…</p>
      ) : gap <= 0 ? (
        <div className="pk-fg-done">
          <p className="pk-fg-done-title">That covers it 🎉</p>
          <p className="small muted">
            Your plan reaches your target — nicely done. Anything extra is a bonus.
          </p>
          <button className="btn btn-primary btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <>
          <p className="pk-fg-head">
            <span className="grams pk-fg-gap">{fmtG(gap)} g</span> to go · ideas from your own
            library
          </p>

          {sugs === null ? (
            <p className="small muted pk-fg-loading">Looking through your library…</p>
          ) : sugs.length === 0 && shownRef.current.size === 0 ? (
            <div className="empty-note">
              Nothing to suggest just yet — your library is looking a little quiet. Add a few
              foods or meals in the Library tab and ideas will show up here.
            </div>
          ) : (
            <>
              <div className="pk-fg-cards">
                {sugs.map((s) => (
                  <div key={s.title} className="card pk-fg-card">
                    <div className="pk-fg-top">
                      <span className="pk-fg-title">{s.title}</span>
                      <span className="grams">{fmtG(s.fiber)} g</span>
                    </div>
                    <p className="small muted">{s.reason}</p>
                    <div className="pk-fg-meta">
                      <span className="pill">→ {SLOT_LABELS[s.slot]}</span>
                      <button
                        className="btn-quiet pk-fg-addbtn"
                        disabled={busyTitle !== null}
                        onClick={() => void handleAdd(s)}
                      >
                        {busyTitle === s.title ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-ghost btn-block pk-fg-more"
                disabled={rolling}
                onClick={() => void moreIdeas()}
              >
                {rolling ? 'Shuffling…' : 'More ideas'}
              </button>
              {exhausted && (
                <p className="small muted pk-fg-note">
                  That's every idea that fits for now — the Library tab is the place to add more.
                </p>
              )}
            </>
          )}

          <p className="small muted pk-fg-foot">
            Going over is fine — your target is a floor, not a ceiling. Suggestions rotate so no
            two days look the same.
          </p>
        </>
      )}
    </Sheet>
  );
}
