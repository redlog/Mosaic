/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // Relative base so the static build also works when served from a
  // subdirectory (e.g. GitHub Pages project pages).
  base: './',

  build: {
    outDir: 'dist',
    sourcemap: true,
  },

  test: {
    // The domain logic in src/lego/ is pure and DOM-free by design, so the
    // default test environment is node. Component tests, when they arrive,
    // opt into jsdom per-file with a `@vitest-environment` docblock.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/lego/**'],
      reporter: ['text', 'html'],
    },
  },
});
