import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The interface is Lao, and the font ships with the app rather than being
// fetched from Google on every first visit. Each file carries its own
// `unicode-range`, so a screen with no Latin never downloads the Latin cut.
// Weights match `f()` in theme.ts — importing one that nothing uses would ship
// bytes for nothing.
import '@fontsource/noto-sans-lao/400.css';
import '@fontsource/noto-sans-lao/500.css';
import '@fontsource/noto-sans-lao/600.css';
import '@fontsource/noto-sans-lao/700.css';
import '@fontsource/noto-sans-lao/800.css';

import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
