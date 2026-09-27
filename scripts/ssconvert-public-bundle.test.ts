import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeAll, expect, it } from "vitest";

let result: Awaited<ReturnType<typeof build>>;
beforeAll(async () => {
  result = await build({
    entryPoints: [new URL("../packages/safe-bash-command-ssconvert/dist/index.js", import.meta.url).pathname],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    write: false,
    metafile: true
  });
});

it("starts the bundled spreadsheet SDK in a Worker without Node module initialization", () => {
  const compiled = readFileSync(new URL("../packages/safe-bash-command-ssconvert/dist/testing/worker-runtime-fixture.js", import.meta.url), "utf8");
  const worker: Record<string, unknown> = { TextEncoder, TextDecoder, atob, AbortController, AbortSignal };
  runInNewContext(compiled, worker);
  expect(worker.snapshot).toEqual({});
  expect(Object.isFrozen(worker.snapshot)).toBe(true);
});

it("ships the spreadsheet SDK without unavailable private runtime dependencies", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const available = new Set(Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }));
  const unavailable = Object.values(result.metafile!.outputs).flatMap(output => output.imports)
    .filter(entry => entry.external && !entry.path.startsWith("node:"))
    .filter(entry => {
      if (entry.path !== manifest.name && !entry.path.startsWith(`${manifest.name}/`)) return true;
      const key = entry.path === manifest.name ? "." : `.${entry.path.slice(manifest.name.length)}`;
      return !Object.hasOwn(manifest.exports, key);
    })
    .map(entry => entry.path.startsWith("@") ? entry.path.split("/").slice(0, 2).join("/") : entry.path.split("/")[0])
    .filter(name => !available.has(name));
  expect([...new Set(unavailable)]).toEqual([]);
});
