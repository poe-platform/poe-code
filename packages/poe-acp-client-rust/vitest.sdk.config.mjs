import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
const unified = path("../poe-acp-client/src/acp-client-unified.test.ts"),
  transport = path("../poe-acp-client/src/acp-transport.test.ts"),
  plan = path("../poe-acp-client/src/plan-events.test.ts");
export default defineConfig({
  plugins: [
    {
      name: "rust-acp-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (importer === transport && name === "./acp-transport.js")
          return path("dist/acp-transport.js");
        if (importer === plan && name === "./stream-helpers.js")
          return path("dist/stream-helpers.js");
        if (
          importer === unified &&
          [
            "./index.js",
            "./types.js",
            "./jsonrpc.js",
            "./jsonrpc-message-layer.js",
            "./acp-client.js",
            "./stream-helpers.js"
          ].includes(name)
        )
          return path("dist/index.js");
      }
    }
  ],
  test: {
    include: [unified, transport, plan],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
