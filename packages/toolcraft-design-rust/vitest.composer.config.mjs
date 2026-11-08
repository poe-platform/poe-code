import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path = name => fileURLToPath(new URL(name, import.meta.url));
export default defineConfig({
  plugins: [{
    name: "rust-composer-reference", enforce: "pre",
    resolveId(name, importer) {
      if (importer === path("../toolcraft-design/src/dashboard/composer.test.ts") && name === "./composer.js") return path("dist/composer.js");
    }
  }],
  test: {
    include: [path("../toolcraft-design/src/dashboard/composer.test.ts")],
    environment: "node", fileParallelism: false, maxWorkers: 1, pool: "forks", testTimeout: 3000, cache: false
  }
});
