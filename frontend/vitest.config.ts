import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vitest config for the frontend unit-test surface.
 *
 * Tests live under ``src/**\/__tests__/``. Pure converter / utility tests
 * can run under the default environment, but component tests using
 * ``@testing-library/react`` need a DOM, so the global default is
 * ``jsdom``. The ``@vitejs/plugin-react`` plugin wires up the React JSX
 * transform so ``.tsx`` test files compile without a separate Babel/SWC
 * step.
 *
 * The path alias ``@/*`` mirrors ``tsconfig.json`` so test code can import
 * shared modules with the same import paths used in app code.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
