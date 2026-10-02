import { build } from "esbuild";
import { readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portableLuaLibraries } from "./portable-lua.mjs";

const require = createRequire(import.meta.url);
const packages = fileURLToPath(new URL("../../", import.meta.url));
const workspaceNames = new Set();
for (const entry of await readdir(packages, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  try {
    workspaceNames.add(JSON.parse(await readFile(path.join(packages, entry.name, "package.json"), "utf8")).name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const external = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(name => workspaceNames.has(name));
const notices = await Promise.all(["fengari", "sprintf-js", "citeproc"].map(async name =>
  readFile(path.join(path.dirname(require.resolve(name + "/package.json")), "LICENSE"), "utf8")));

// Prepare portable adapters and embed third-party parsers. First-party engines
// and contracts retain their canonical workspace owners in the parent bundle.
await rm("dist/chunks", { recursive: true, force: true });
await build({
  entryPoints: ["src/options.ts", "src/index.ts", "src/command.ts", "src/lua-filters.ts", "src/citeproc-filters.ts"], outdir: "dist",
  bundle: true, platform: "browser", format: "esm", target: "es2022",
  external, splitting: true, chunkNames: "chunks/[name]-[hash]", sourcemap: true,
  define: { process: "undefined", "process.env.FENGARICONF": '"{}"' },
  plugins: [portableLuaLibraries],
  banner: { js: notices.map(notice => "/*!\n" + notice + "\n*/").join("\n") },
});
