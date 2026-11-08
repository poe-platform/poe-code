import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@poe-code/safe-js":
        process.env.H5_REVIEW_PUBLIC_ENTRY ??
        fileURLToPath(new URL("../src/index.ts", import.meta.url))
    }
  },
  test: {
    include: [
      "packages/safe-js/test/h5-context-converter-review.test.ts",
      ...(process.env.H5_REVIEW_AUTHOR_TEST_ROOT
        ? [process.env.H5_REVIEW_AUTHOR_TEST_ROOT + "/final-async-proof*.test.ts"]
        : []),
      ...(process.env.H5_REVIEW_EXTRA_TESTS?.split(",") ?? [])
    ],
    pool: "forks",
    maxWorkers: 1
  }
});
