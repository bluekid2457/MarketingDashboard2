/**
 * Vitest global setup.
 *
 * Wires ``@testing-library/jest-dom`` matchers (``toBeInTheDocument`` etc.)
 * onto vitest's ``expect``. Component tests under ``src/components/__tests__``
 * rely on these matchers.
 *
 * Also installs an ``afterEach`` hook that calls ``cleanup`` so the DOM
 * left over from one test does not bleed into the next. With ``globals: false``
 * in ``vitest.config.ts`` the library's auto-cleanup hook (which only fires
 * when vitest globals are enabled) does not run, so we wire it manually.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
