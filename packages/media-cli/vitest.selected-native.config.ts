import { defineConfig } from 'vitest/config';
/** Explicit selected-image tests; never included by unit or Homebrew-native routes. */
// Two container launches have separate 25-second Docker deadlines; allow host
// scheduling headroom for this opt-in emulated suite without extending child limits.
// Admission also launches several sequential Docker checks before any fixture runs.
export default defineConfig({ test: { include: ['integration/selected-ordering.native.test.ts'], maxWorkers: 1, testTimeout: 180000, hookTimeout: 180000 } });
