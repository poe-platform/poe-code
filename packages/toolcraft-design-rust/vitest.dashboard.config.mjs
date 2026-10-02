import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";
const path = name => fileURLToPath(new URL(name, import.meta.url));
const suite = path("../toolcraft-design/src/dashboard/dashboard.test.ts");
export default defineConfig({
  plugins: [{
    name: "rust-dashboard-reference", enforce: "pre",
    resolveId(name, importer) {
      if (importer === path("../toolcraft-design/src/dashboard/components/stats-pane.ts") && name === "../elapsed.js") return path("dist/dashboard-elapsed.js");
      if (importer === suite && name === "./components/footer.js") return path("dist/dashboard-footer.js");
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
    include: [suite], testNamePattern: "^(keymap|store|ScreenBuffer|diff|cellToAnsi|renderBorder|computeDashboardLayout|footer) |^stats pane formatElapsed ",
    environment: "node", fileParallelism: false, maxWorkers: 1, pool: "forks", testTimeout: 3000, cache: false
  }
});
