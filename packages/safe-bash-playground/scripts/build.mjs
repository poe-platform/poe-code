import { build } from "vite";
import { fileURLToPath } from "node:url";
import { safeBashBrowserPlugin } from "../src/engine/build-plugin.mjs";

await build({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  base: "./",
  plugins: [safeBashBrowserPlugin()],
  worker: { format: "es", plugins: () => [safeBashBrowserPlugin()] },
  build: {
    outDir: "dist/site",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes("/@jspm/core/") || id.includes("/@noble/hashes/")) return "browser-platform";
          if (id.includes("/safe-bash-engine/packages/safe-js/dist/browser/")) return "browser-filesystem";
          if (id === "\0safe-bash-browser-workers") return "browser-workers";
          if (id.includes("/safe-bash/dist/shell/")) return "browser-shell";
          if (id.includes("/safe-bash/dist/commands/structured/")) return "browser-structured";
          if (id.includes("/safe-bash/dist/commands/text-programs/")) return "browser-text-programs";
          if (id.includes("/safe-bash/dist/commands/")) return "browser-commands";
        }
      }
    }
  }
});
