import type { Tab } from '../nav';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'today', label: 'Today', icon: '◉' },
  { id: 'library', label: 'Library', icon: '❋' },
  { id: 'history', label: 'History', icon: '▦' },
];

export default function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={active === t.id ? 'on' : ''}
          onClick={() => onChange(t.id)}
          aria-label={t.label}
        >
          <span className="tab-dash" />
          <span className="tab-ico" aria-hidden="true">
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
