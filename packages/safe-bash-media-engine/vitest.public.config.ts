import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  include: ['tests/public-consumer.test.ts'],
  maxWorkers: 1,
  // Public consumers load built ESM through Node, without Vite transforming
  // the shipped shell and its optional runtime dependencies on first use.
  deps: { moduleDirectories: ['/node_modules/', '/dist/'] },
} });
