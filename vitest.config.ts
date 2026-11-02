import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
    // Tests assert on plain CLI output. picocolors turns colors on whenever CI is set
    // (GitHub Actions does), so pin colors off for the test workers and the CLIs they spawn.
    env: { NO_COLOR: '1' },
  },
});
