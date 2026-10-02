import { defineConfig } from "vitest/config";
// Each differential performs two native launches; their subprocess deadlines
// are five seconds each, excluding startup and fixture/effect collection.
export default defineConfig({ test: { include: ["integration/**/*.native.ts"], maxWorkers: 1, testTimeout: 20000 } });
