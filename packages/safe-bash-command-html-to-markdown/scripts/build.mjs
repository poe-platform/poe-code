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
  plugins: [{
    name: "pack-idna-ranges",
    setup(builder) {
      builder.onLoad({ filter: /[/\\]tr46[/\\]lib[/\\]mappingTable\.json$/ }, async ({ path }) => {
        const rows = JSON.parse(await readFile(path, "utf8"));
        // UTS #46 covers consecutive code points. Store widths instead of both endpoints.
        let next = 0;
        for (const row of rows) {
          const [start, end] = Array.isArray(row[0]) ? row[0] : [row[0], row[0]];
          if (start !== next || end < start) throw new Error("Non-contiguous IDNA mapping table");
          row[0] = end - start;
          next = end + 1;
        }
        return { loader: "js", contents: `
          const rows = ${JSON.stringify(rows)};
          let next = 0;
          for (const row of rows) {
            const start = next;
            next += row[0] + 1;
            row[0] = row[0] ? [start, next - 1] : start;
          }
          export default rows;` };
      });
    },
  }],
});
