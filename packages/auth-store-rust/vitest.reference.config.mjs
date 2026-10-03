import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const path = name => fileURLToPath(new URL(name, import.meta.url));
const suites = ["safe-fs-secret-store", "provider-store"];
export default defineConfig({
  plugins: [{ name: "auth-store-portable-reference", enforce: "pre", resolveId(name, importer) {
    if (suites.some(suite => importer === path(`../auth-store/src/${suite}.test.ts`)) && ["./safe-fs-secret-store.js", "./provider-store.js"].includes(name)) return path("dist/index.browser.js");
  } }],
  test: { include: suites.map(suite => path(`../auth-store/src/${suite}.test.ts`)), fileParallelism: false, maxWorkers: 1 }
});
