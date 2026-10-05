import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const directory = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
// Bundle immutable IDNA data while keeping shared command/filesystem identities
// external. JSON imports must not lose their attributes in downstream ES2022 builds.
await build({
  absWorkingDir: directory,
  entryPoints: Object.fromEntries(Object.values(manifest.exports).map(target => {
    const entry = target.import.slice("./dist/".length, -3);
    return [entry, path.join(directory, "src", entry + ".ts")];
  })),
  outdir: "dist", bundle: true, splitting: true, format: "esm", platform: "browser",
  target: "es2022", external: Object.keys(manifest.devDependencies),
});
