import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const path = value => fileURLToPath(new URL(value, import.meta.url));
export default defineConfig({
  plugins: [{ name: "native-approval-reference", enforce: "pre", resolveId(name, importer) {
    if (importer?.startsWith(path("../agent-human-in-loop/src/")) && name.startsWith(".")) {
      const resolved = resolve(dirname(importer), name);
      for (const module of ["index", "request-approval", "providers/mock", "providers/osascript", "providers/osascript-script"])
        if (resolved === path(`../agent-human-in-loop/src/${module}.js`)) return path(`dist/${module.split("/").at(-1)}.js`);
    }
  } }],
  test: { include: [path("../agent-human-in-loop/src/**/*.test.ts"), path("tests/*.test.ts")], environment: "node", fileParallelism: false, pool: "forks", maxWorkers: 1, testTimeout: 3000, cache: false }
});
