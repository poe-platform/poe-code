import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));
const suites = ["suggest", "runtime-logging"];

export default defineConfig({
  plugins: [
    {
      name: "toolcraft-rust-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (
          suites.some(
            (suite) =>
              importer === path(`../toolcraft/src/${suite}.test.ts`) && name === `./${suite}.js`
          )
        )
          return path("dist/index.js");
      }
    }
  ],
  test: {
    include: suites.map((suite) => path(`../toolcraft/src/${suite}.test.ts`)),
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
