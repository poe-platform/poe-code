import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

test("mktemp and compression staging browser graphs need no Node crypto", async () => {
  const platform = fileURLToPath(new URL("../../browser/platform.mjs", import.meta.url));
  const peers = ["node:stream", "node:stream/promises", "node:zlib"];
  const result = await build({
    entryPoints: ["metadata/mktemp.ts", "bytes/compression/files.ts"].map(entry => fileURLToPath(new URL(`../../src/commands/${entry}`, import.meta.url))),
    outdir: "/tmp/issue-672-random-graph", bundle: true, write: false, metafile: true,
    platform: "browser", format: "esm", target: "es2022", conditions: ["workerd", "worker", "browser"],
    external: ["poe-code/safe-fs/core", ...peers],
    alias: { "node:path": platform, "node:stream/web": platform }, inject: [platform], logLevel: "silent",
  });
  const external = Object.values(result.metafile!.outputs).flatMap(output => output.imports).filter(imported => imported.external);
  for (const imported of external) assert.ok(["poe-code/safe-fs/core", ...peers].includes(imported.path), imported.path);
});

test("portable random indices reject biased samples and bind Web Crypto", async context => {
  const { randomInteger } = await import("../../src/commands/portable-random.js");
  const samples = [4294967295, 4294967292, 62, 61];
  const crypto = globalThis.crypto;
  context.mock.method(crypto, "getRandomValues", function(this: unknown, bytes: Uint32Array) {
    assert.equal(this, crypto);
    assert.ok(bytes instanceof Uint32Array);
    assert.equal(bytes.length, 1);
    assert.ok(samples.length > 0);
    bytes[0] = samples.shift()!;
    return bytes;
  });
  assert.equal(randomInteger(62), 0);
  assert.equal(randomInteger(62), 61);
  assert.equal(samples.length, 0);
});

test("portable random validates its range before requesting entropy", async context => {
  const { randomInteger } = await import("../../src/commands/portable-random.js");
  context.mock.method(globalThis.crypto, "getRandomValues", () => assert.fail("unexpected entropy request"));
  for (const maximum of [0, -1, 1.5, NaN, Infinity, 4294967297]) {
    assert.throws(() => randomInteger(maximum), RangeError);
  }
});

test("portable random preserves entropy failures without insecure fallback", async context => {
  const { randomInteger } = await import("../../src/commands/portable-random.js");
  const failure = new Error("entropy unavailable");
  context.mock.method(globalThis.crypto, "getRandomValues", () => { throw failure; });
  context.mock.method(Math, "random", () => assert.fail("insecure entropy fallback"));
  assert.throws(() => randomInteger(62), error => error === failure);
});
