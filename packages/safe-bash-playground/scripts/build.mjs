import { build } from "vite";
import { fileURLToPath } from "node:url";
import { safeBashBrowserPlugin } from "../src/engine/build-plugin.mjs";

await build({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false,
  base: "./",
  plugins: [safeBashBrowserPlugin()],
  build: {
    outDir: "dist/site",
    emptyOutDir: true,
    target: "es2022"
  }
});
