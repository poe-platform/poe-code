import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["scripts/postinstall-sync-skills.lifecycle.test.ts"],
    maxWorkers: 1,
    setupFiles: ["tests/setup.ts"]
  }
});
