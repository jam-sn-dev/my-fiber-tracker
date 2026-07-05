import type { ReactNode } from 'react';

interface RingProps {
  eaten: number;
  planned: number; // planned-but-not-eaten grams
  target: number;
  size?: number; // css pixels
  children?: ReactNode; // centered content
}

/**
 * The day's progress ring: solid leaf arc = eaten, light arc = planned,
 * track = remaining to target. Overshoot past the target simply fills the ring.
 */
export default function Ring({ eaten, planned, target, size = 150, children }: RingProps) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const denom = Math.max(target, eaten + planned, 0.0001);
  const eatenFrac = Math.min(1, eaten / denom);
  const plannedFrac = Math.min(1 - eatenFrac, planned / denom);

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="var(--line)" strokeWidth="12" />
        {eatenFrac > 0 && (
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="var(--leaf)"
            strokeWidth="12"
            strokeDasharray={`${eatenFrac * C} ${C}`}
            transform="rotate(-90 60 60)"
          />
        )}
        {plannedFrac > 0 && (
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="var(--leaf-tint)"
            strokeWidth="12"
            strokeDasharray={`${plannedFrac * C} ${C}`}
            strokeDashoffset={-eatenFrac * C}
            transform="rotate(-90 60 60)"
          />
        )}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}
