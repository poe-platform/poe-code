import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
const providers = path("../poe-agent/src/runtime/resolve-provider.test.ts"),
  names = path("../poe-agent/src/runtime/tool-names.test.ts");
export default defineConfig({
  plugins: [
    {
      name: "rust-agent-runtime-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (importer === providers && name === "./resolve-provider.js")
          return path("dist/providers.js");
        if (
          importer === path("../poe-agent/src/session-store.test.ts") &&
          name === "./session-store.js"
        )
          return path("dist/session-store.js");
        if (importer === names && name === "./tool-names.js") return path("dist/tool-names.js");
      }
    }
  ],
  test: {
    include: [providers, names, path("../poe-agent/src/session-store.test.ts")],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
