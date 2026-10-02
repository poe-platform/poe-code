import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path = name => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  plugins: [{
    name: "rust-composer-layout-reference", enforce: "pre",
    resolveId(name, importer) {
      if (importer === path("../toolcraft-design/src/dashboard/composer.ts") && name === "./composer-layout.js") return path("dist/composer-layout.js");
    }
  }],
  test: {
    include: [path("../toolcraft-design/src/dashboard/composer.test.ts")],
    testNamePattern: "^dashboard queue composer (moves vertically|moves through wrapped|resets the desired|recalculates the desired)",
    environment: "node", fileParallelism: false, maxWorkers: 1, pool: "forks", testTimeout: 3000, cache: false
  }
});
