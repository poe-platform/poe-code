import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const notices = await Promise.all(["fengari", "sprintf-js"].map(async name =>
  readFile(path.join(path.dirname(require.resolve(name + "/package.json")), "LICENSE"), "utf8")));

// Select Fengari's portable runtime, excluding its unused native I/O libraries.
// Keep the converter's error constructor shared with the rest of the SDK.
await build({
  entryPoints: ["src/lua-filters.ts"], outfile: "dist/lua-filters.js",
  bundle: true, platform: "browser", format: "esm", target: "es2022",
  external: ["./errors.js"], sourcemap: true,
  define: { process: "undefined", "process.env.FENGARICONF": '"{}"' },
  banner: { js: notices.map(notice => "/*!\n" + notice + "\n*/").join("\n") },
});
