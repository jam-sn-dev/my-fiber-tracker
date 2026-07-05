import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/base.css';

// Ask the browser to treat our IndexedDB as durable so the whole library +
// history isn't silently evicted under storage pressure. (WebKit still caps
// non-installed Safari-tab storage at ~7 days of non-use — the Today screen
// shows an add-to-Home-Screen nudge for that case.)
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  void navigator.storage.persist();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
