import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Served from a GitHub Pages project subpath. Single source of truth: the
// manifest's start_url/id/scope must all sit under this, or an installed PWA
// launches the domain root and 404s.
const BASE = '/my-fiber-tracker/';

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'Fibi — Fiber Planner',
        short_name: 'Fibi',
        description: 'Plan a whole day of fiber in minutes.',
        theme_color: '#FCFCF9',
        background_color: '#FCFCF9',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
});
