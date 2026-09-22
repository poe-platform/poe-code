import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("starts the bundled spreadsheet SDK in a Worker without Node module initialization", async () => {
  const result = await build({
    stdin: {
      contents: 'import { snapshotRuntimeFunctions } from "./packages/ssconvert/dist/index.js"; globalThis.snapshot = snapshotRuntimeFunctions({});',
      resolveDir: new URL("../", import.meta.url).pathname,
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  const worker: Record<string, unknown> = { TextEncoder, TextDecoder };
  runInNewContext(result.outputFiles[0]!.text, worker);
  expect(worker.snapshot).toEqual({});
  expect(Object.isFrozen(worker.snapshot)).toBe(true);
});

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
