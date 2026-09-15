import { configDefaults, defineConfig } from "vitest/config";
import quarantine from "./test-quarantine.json";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Temporary release exclusions; restoration steps are in docs/plans.
    exclude: [...configDefaults.exclude, ...quarantine]
  }
});
