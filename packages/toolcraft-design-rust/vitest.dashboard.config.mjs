import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path = name => fileURLToPath(new URL(name, import.meta.url));
const suite = path("../toolcraft-design/src/dashboard/dashboard.test.ts");
export default defineConfig({
  plugins: [{
    name: "rust-dashboard-reference", enforce: "pre",
    resolveId(name, importer) {
      if ([suite, path("../toolcraft-design/src/dashboard/queue-interaction.test.ts")].includes(importer)) {
        if (name === "./dashboard.js") return path("dist/dashboard-runtime.js");
        if (name === "../internal/output-format.js") return path("dist/logging.js");
      }
      if (importer === path("../toolcraft-design/src/dashboard/components/stats-pane.ts") && name === "../elapsed.js") return path("dist/dashboard-elapsed.js");
      if (importer === suite && name === "./components/footer.js") return path("dist/dashboard-footer.js");
      if (importer === suite && name === "./components/output-pane.js") return path("dist/dashboard-output.js");
      if (importer === suite && name === "./components/stats-pane.js") return path("dist/dashboard-stats.js");
      if (importer === suite && name === "../internal/theme-state.js") return path("dist/theme-state.js");
      if (importer === suite && name === "../internal/theme-detect.js") return path("dist/theme.js");
      if (importer === suite && name === "./keymap.js") return path("dist/dashboard-keymap.js");
      if (importer === suite && name === "./components/border.js") return path("dist/dashboard-border.js");
      if (importer === suite && name === "./layout.js") return path("dist/dashboard-layout.js");
      if (importer === suite && name === "./buffer.js") return path("dist/dashboard-buffer.js");
      if (importer === suite && name === "./store.js") return path("dist/dashboard-store.js");
    }
  }],
  test: {
    include: [suite, path("../toolcraft-design/src/dashboard/queue-interaction.test.ts")],
    environment: "node", fileParallelism: false, maxWorkers: 1, pool: "forks", testTimeout: 3000, cache: false
  }
});
