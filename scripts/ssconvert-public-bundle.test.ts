import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("ships the spreadsheet SDK without unavailable private runtime dependencies", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const result = await build({
    entryPoints: [new URL("../packages/ssconvert/dist/index.js", import.meta.url).pathname],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    write: false,
    metafile: true
  });
  const available = new Set(Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }));
  const unavailable = Object.values(result.metafile!.outputs).flatMap(output => output.imports)
    .filter(entry => entry.external && !entry.path.startsWith("node:"))
    .map(entry => entry.path.startsWith("@") ? entry.path.split("/").slice(0, 2).join("/") : entry.path.split("/")[0])
    .filter(name => !available.has(name));
  expect([...new Set(unavailable)]).toEqual([]);
});
