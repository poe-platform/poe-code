import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const consumer = resolve(process.argv[2] ?? ".");
await build({
  absWorkingDir: consumer,
  entryPoints: ["safe-packages-browser.mjs"],
  bundle: true, platform: "browser", format: "esm", outfile: "browser.mjs",
  plugins: [{ name: "fixture-wasm-modules", setup(builder) {
    // Browser/Worker asset imports supply compiled modules. Preserve that
    // contract while executing the installed browser fixture under Node.
    builder.onLoad({ filter: /\.wasm$/ }, async ({ path }) => ({
      contents: `export default new WebAssembly.Module(Uint8Array.from(atob(${JSON.stringify((await readFile(path)).toString("base64"))}), byte => byte.charCodeAt(0)));`,
      loader: "js",
    }));
  } }],
});
await import(pathToFileURL(resolve(consumer, "browser.mjs")).href);
