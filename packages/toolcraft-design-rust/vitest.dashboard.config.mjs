import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path = name => fileURLToPath(new URL(name, import.meta.url));
const suite = path("../toolcraft-design/src/dashboard/dashboard.test.ts");
export default defineConfig({
  plugins: [{
    name: "rust-dashboard-reference", enforce: "pre",
    resolveId(name, importer) {
      if (importer === suite && name === "./keymap.js") return path("dist/dashboard-keymap.js");
      if (importer === suite && name === "./store.js") return path("dist/dashboard-store.js");
    }
  }],
  test: {
    include: [suite], testNamePattern: "^(keymap|store) ",
    environment: "node", fileParallelism: false, maxWorkers: 1, pool: "forks", testTimeout: 3000, cache: false
  }
});
