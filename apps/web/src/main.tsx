import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.js';
import './index.css';

const container = document.getElementById('root');

if (container === null) {
  // Louder than a silent no-op: a blank page with no console error is the
  // hardest kind of front-end failure to diagnose.
  throw new Error('No #root element to mount into.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
