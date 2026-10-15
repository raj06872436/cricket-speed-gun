import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths so the app works from any sub-path, e.g. GitHub Pages.
  base: './',
  build: { target: 'es2020' },
  test: { include: ['tests/**/*.test.ts'] },
});
