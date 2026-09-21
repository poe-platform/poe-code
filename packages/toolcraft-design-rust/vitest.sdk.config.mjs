import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
export default defineConfig({
  plugins: [
    {
      name: "rust-design-color-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (!importer) return;
        if(importer===path("../toolcraft-design/src/dashboard/terminal-width.test.ts")&&name==="./terminal-width.js")return path("dist/terminal.js");
        if(importer===path("../toolcraft-design/src/acp/plan.test.ts")){
          if(name==="./plan.js"||name==="./writer.js")return path("dist/acp.js");
          if(name==="../internal/output-format.js")return path("dist/logging.js");
          if(name==="../dashboard/ansi.js")return path("dist/terminal.js");
        }
        if (
          importer === path("../toolcraft-design/src/components/color.test.ts") &&
          name === "./color.js"
        )
          return path("dist/color.js");
        if (importer === path("../toolcraft-design/src/tokens/colors.test.ts")) {
          if (name === "../internal/color-support.js") return path("dist/color-support.js");
          if (name === "../internal/theme-state.js") return path("dist/theme-state.js");
          if (name === "./brand.js" || name === "./colors.js") return path("dist/theme.js");
        }
        if (
          importer === path("../toolcraft-design/src/internal/theme-state.test.ts") &&
          name === "./theme-state.js"
        )
          return path("dist/theme-state.js");
      }
    }
  ],
  test: {
    include: [
      path("../toolcraft-design/src/dashboard/terminal-width.test.ts"),
      path("../toolcraft-design/src/acp/plan.test.ts"),
      path("../toolcraft-design/src/components/color.test.ts"),
      path("../toolcraft-design/src/tokens/colors.test.ts"),
      path("../toolcraft-design/src/internal/theme-state.test.ts")
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
