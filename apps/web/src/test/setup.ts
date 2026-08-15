import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/** Unmount between tests, so a leaked provider cannot leak state into the next. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
