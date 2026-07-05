#!/usr/bin/env node
/**
 * Renders the Fibi app icon to the PWA png sizes referenced by
 * vite.config.ts and index.html:
 *
 *   public/pwa-192.png          192x192, rounded corners
 *   public/pwa-512.png          512x512, rounded corners
 *   public/apple-touch-icon.png 180x180, full-bleed square (iOS rounds it)
 *
 * Icon: leaf-green rounded square with a white progress-ring arc (round
 * caps, small gap) and a white dot marking the arc end — the app's ring
 * motif, readable at 60px.
 *
 * Run: node scripts/gen-icons.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public');

const SIZE = 1024; // master render size; sharp downsamples per target
const GREEN = '#2E7B45';

/** Point on a circle: angle in degrees clockwise from 12 o'clock. */
function point(deg, radius, cx, cy) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

const fx = (n) => Math.round(n * 100) / 100;

function iconSvg({ rounded }) {
  const s = SIZE;
  const rx = rounded ? Math.round(s * 0.22) : 0; // ~22% corner radius
  const cx = s / 2;
  const cy = s / 2;
  const ringR = (s * 0.62) / 2; // ring spans ~62% of the icon width
  const stroke = Math.round(s * 0.11); // stroke ~11% of size
  const sweep = 278; // arc degrees, clockwise from the top — leaves a gap
  const start = point(0, ringR, cx, cy);
  const end = point(sweep, ringR, cx, cy);
  const dot = point(sweep + 34, ringR, cx, cy); // sits in the gap, past the cap
  const dotR = stroke * 0.5;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${rx}" fill="${GREEN}"/>
  <path d="M ${fx(start.x)} ${fx(start.y)} A ${fx(ringR)} ${fx(ringR)} 0 1 1 ${fx(end.x)} ${fx(end.y)}"
        fill="none" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round"/>
  <circle cx="${fx(dot.x)}" cy="${fx(dot.y)}" r="${fx(dotR)}" fill="#ffffff"/>
</svg>`;
}

const TARGETS = [
  { file: 'pwa-192.png', size: 192, rounded: true },
  { file: 'pwa-512.png', size: 512, rounded: true },
  // Full-bleed with NO rounding: iOS applies its own corner mask.
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
];

await mkdir(OUT_DIR, { recursive: true });

for (const t of TARGETS) {
  const svg = iconSvg({ rounded: t.rounded });
  await sharp(Buffer.from(svg)).resize(t.size, t.size).png().toFile(path.join(OUT_DIR, t.file));
  console.log(`wrote public/${t.file} (${t.size}x${t.size})`);
}
