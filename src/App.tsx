import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { NavContext, type Modal, type Tab } from './nav';
import { seedIfEmpty, ensureDay } from './db/repo';
import { todayKey } from './lib/dates';
import TabBar from './components/TabBar';
import TodayScreen from './screens/Today/TodayScreen';
import LibraryScreen from './screens/Library/LibraryScreen';
import HistoryScreen from './screens/History/HistoryScreen';
import SettingsSheet from './screens/Settings/SettingsSheet';
import AddEntrySheet from './flows/AddEntry/AddEntrySheet';
import FillGapSheet from './flows/FillGap/FillGapSheet';
import FoodFormSheet from './flows/FoodForm/FoodFormSheet';
import ScanLabelSheet from './flows/ScanLabel/ScanLabelSheet';
import ScanListSheet from './flows/ScanList/ScanListSheet';
import ImportLinkSheet from './flows/ImportLink/ImportLinkSheet';
import MealBuilderSheet from './flows/MealBuilder/MealBuilderSheet';
import DayDetailSheet from './flows/DayDetail/DayDetailSheet';

// Module-level singleton: StrictMode double-invokes effects in dev, and the
// first-run seed must never race itself.
let bootPromise: Promise<void> | null = null;
function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      await seedIfEmpty();
      await ensureDay(todayKey());
    })();
  }
  return bootPromise;
}

/** Forget a failed/hung boot attempt so Retry starts a fresh one. */
function resetBoot(): void {
  bootPromise = null;
}

/**
 * Guard against IndexedDB never resolving (a long-standing intermittent iOS
 * Safari bug after device restart): if boot hangs, surface the error/retry
 * screen instead of a permanent blank page.
 */
function bootWithTimeout(ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Storage did not open in time.')),
      ms,
    );
    boot().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const bootScreenStyle: CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '16px',
  padding: '24px',
  textAlign: 'center',
};

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [modals, setModals] = useState<Modal[]>([]);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<Error | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    bootWithTimeout(10_000).then(
      () => {
        if (!cancelled) setReady(true);
      },
      (err: unknown) => {
        if (!cancelled) setBootError(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  function retryBoot() {
    resetBoot();
    setBootError(null);
    setBootAttempt((n) => n + 1);
  }

  const nav = useMemo(
    () => ({
      openModal: (m: Modal) => setModals((s) => [...s, m]),
      closeModal: () => setModals((s) => s.slice(0, -1)),
    }),
    [],
  );

  if (bootError) {
    return (
      <div className="app" style={bootScreenStyle} role="alert">
        <p>
          Fibi couldn’t open its storage on this device. Your data is safe — this is usually a
          one-off hiccup.
        </p>
        <p className="small muted">{bootError.message}</p>
        <button className="btn btn-primary" onClick={retryBoot}>
          Try again
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="app" style={bootScreenStyle} role="status" aria-live="polite">
        <p className="muted">Loading Fibi…</p>
      </div>
    );
  }

  return (
    <NavContext.Provider value={nav}>
      <div className="app">
        {tab === 'today' && <TodayScreen />}
        {tab === 'library' && <LibraryScreen />}
        {tab === 'history' && <HistoryScreen />}
        <TabBar active={tab} onChange={setTab} />
        {modals.map((m, i) => (
          <ModalView key={i} modal={m} onClose={nav.closeModal} />
        ))}
      </div>
    </NavContext.Provider>
  );
}

function ModalView({ modal, onClose }: { modal: Modal; onClose: () => void }) {
  switch (modal.type) {
    case 'addEntry':
      return <AddEntrySheet date={modal.date} slot={modal.slot} onClose={onClose} />;
    case 'fillGap':
      return <FillGapSheet date={modal.date} onClose={onClose} />;
    case 'foodForm':
      return <FoodFormSheet foodId={modal.foodId} onSaved={modal.onSaved} onClose={onClose} />;
    case 'scanLabel':
      return <ScanLabelSheet onSaved={modal.onSaved} onClose={onClose} />;
    case 'scanList':
      return <ScanListSheet onClose={onClose} />;
    case 'importLink':
      return <ImportLinkSheet onSaved={modal.onSaved} onClose={onClose} />;
    case 'mealBuilder':
      return <MealBuilderSheet mealId={modal.mealId} onClose={onClose} />;
    case 'dayDetail':
      return <DayDetailSheet date={modal.date} onClose={onClose} />;
    case 'settings':
      return <SettingsSheet onClose={onClose} />;
  }
}
