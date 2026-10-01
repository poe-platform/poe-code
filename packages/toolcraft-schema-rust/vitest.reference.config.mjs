import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));

export default defineConfig({
  root: path("../../"),
  plugins: [
    {
      name: "schema-rust-host-values",
      enforce: "pre",
      resolveId(name, importer) {
        if (name === "toolcraft-schema") return path("dist/index.js");
        if (!importer?.startsWith(path("../toolcraft-schema/src/"))) return;
        if (name === "./index.js" || name === "../index.js") return path("dist/index.js");
        if (name === "./validate.js" || name === "../validate.js")
          return path("dist/host-values.js");
        if (name === "./clone-default.js") return path("dist/host-values.js");
        if (name === "./json.js") return path("dist/host-values.js");
        if (name === "./normalize-nullability.js") return path("dist/compiler.js");
      }
    }
  ],
  test: {
    include: [path("../toolcraft-schema/src/**/*.test.ts")],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
