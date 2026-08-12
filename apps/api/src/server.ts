/**
 * Process entry point. Everything interesting is in `app.ts`.
 *
 * Split so the application can be constructed in a test without binding a
 * port, which is what lets the integration suite drive real HTTP through the
 * real router rather than calling handlers directly.
 */

import { createApp } from './app.js';

const port = Number(process.env['PORT'] ?? 5000);

createApp().listen(port, () => {
  console.warn(`AuraPMS API listening on http://localhost:${String(port)}`);
});
