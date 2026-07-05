import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { DEFAULT_SETTINGS, type Day } from '../../types';
import { formatDayShort, todayKey } from '../../lib/dates';
import { fmtG } from '../../lib/fiber';
import { useNav } from '../../nav';
import { dayOutcome, mondayOffset, monthKeys, summarizeMonth } from '../../lib/stats';
import './history.css';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function HistoryScreen() {
  const { openModal } = useNav();
  const [ym, setYm] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), monthIndex: n.getMonth() };
  });
  const { year, monthIndex } = ym;

  const keys = monthKeys(year, monthIndex);
  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];

  const dayRows = useLiveQuery(
    () => db.days.where('date').between(firstKey, lastKey, true, true).toArray(),
    [year, monthIndex],
  );
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const closeMargin = settings?.closeMarginGrams ?? DEFAULT_SETTINGS.closeMarginGrams;

  const byDate = new Map<string, Day>((dayRows ?? []).map((d) => [d.date, d]));
  const today = todayKey();
  const summary = summarizeMonth(byDate, keys, closeMargin, today);

  const now = new Date();
  const atCurrentMonth = year === now.getFullYear() && monthIndex === now.getMonth();
  const monthLabel = new Date(year, monthIndex, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const offset = mondayOffset(year, monthIndex);

  const shiftMonth = (delta: number) =>
    setYm((s) => {
      const d = new Date(s.year, s.monthIndex + delta, 1);
      return { year: d.getFullYear(), monthIndex: d.getMonth() };
    });

  return (
    <div className="screen-scroll">
      <h1 className="screen-title">History</h1>

      <div className="hs-monthnav">
        <button className="hs-navbtn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
          ‹
        </button>
        <div className="hs-monthlabel">{monthLabel}</div>
        <button
          className="hs-navbtn"
          onClick={() => shiftMonth(1)}
          disabled={atCurrentMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="hs-grid">
        {WEEKDAYS.map((w, i) => (
          <div key={`w${i}`} className="hs-wd" aria-hidden="true">
            {w}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`blank${i}`} className="hs-cell" />
        ))}
        {keys.map((key, i) => {
          const day = byDate.get(key);
          const isToday = key === today;
          const isFuture = key > today;
          let cls = 'hs-day';
          if (isFuture) cls += ' hs-future';
          else if (isToday) cls += ' hs-today';
          else cls += ` hs-${dayOutcome(day, closeMargin)}`;
          const tappable = !isFuture && day != null;
          return (
            <div key={key} className="hs-cell">
              {tappable ? (
                <button
                  className={cls}
                  onClick={() => openModal({ type: 'dayDetail', date: key })}
                  aria-label={`See ${formatDayShort(key)}`}
                >
                  {i + 1}
                </button>
              ) : (
                <div className={cls}>{i + 1}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="hs-legend">
        <span className="hs-leg">
          <span className="hs-legdot hs-legdot-hit" />
          Hit
        </span>
        <span className="hs-leg">
          <span className="hs-legdot hs-legdot-close" />
          Close
        </span>
        <span className="hs-leg">
          <span className="hs-legdot hs-legdot-missed" />
          Missed
        </span>
      </div>

      <div className="hs-stats">
        <div className="card hs-stat">
          <div className="hs-stat-num">
            {summary.daysHit + summary.daysClose}/{summary.daysLogged}
            <span className="hs-stat-unit"> days</span>
          </div>
          <div className="hs-stat-label">on target</div>
        </div>
        <div className="card hs-stat">
          <div className="hs-stat-num">
            {fmtG(summary.avgEaten)}
            <span className="hs-stat-unit"> g</span>
          </div>
          <div className="hs-stat-label">daily average</div>
        </div>
        <div className="card hs-stat">
          <div className="hs-stat-num">{summary.bestStreak}</div>
          <div className="hs-stat-label">best streak</div>
        </div>
      </div>

      <p className="hs-note">
        Counted from what you check off as eaten — today joins the chart tomorrow.
      </p>
    </div>
  );
}
