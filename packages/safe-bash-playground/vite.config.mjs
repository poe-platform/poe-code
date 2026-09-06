import { safeBashBrowserPlugin } from "./src/engine/build-plugin.mjs";

export default {
  plugins: [safeBashBrowserPlugin()],
  worker: { format: "es", plugins: () => [safeBashBrowserPlugin()] }
};
