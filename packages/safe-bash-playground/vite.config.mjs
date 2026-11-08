import { safeBashBrowserPlugin } from "./src/engine/build-plugin.mjs";

export default {
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
  plugins: [safeBashBrowserPlugin()],
  worker: { format: "es", plugins: () => [safeBashBrowserPlugin()] }
};
