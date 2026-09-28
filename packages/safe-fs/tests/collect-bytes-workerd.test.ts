import { expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

it("selects the portable collector with opt-in limits using the workerd condition alone", async () => {
  const output = await build({
    entryPoints: [fileURLToPath(new URL("../src/contracts/io.ts", import.meta.url))],
    bundle: true, platform: "neutral", conditions: ["workerd"],
    format: "iife", globalName: "collector", write: false, metafile: true,
    logLevel: "silent"
  });
  expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/browser.ts"))).toBe(true);
  expect(Object.keys(output.metafile!.inputs).some(input => input.endsWith("platform/node.ts"))).toBe(false);
  const context = createContext({ Uint8Array });
  runInContext(output.outputFiles[0]!.text, context);
  for (const size of [15, 17]) {
    const result = await runInContext(`collector.collectBytes((async function* () {
      yield new Uint8Array(${size} * 1024 * 1024);
    })(), {})`, context) as Uint8Array;
    expect(result.length).toBe(size * 1024 * 1024);
  }
  await expect(runInContext(`collector.collectBytes((async function* () {
    yield new Uint8Array(17);
  })(), { maxBytes: 16 })`, context)).rejects.toMatchObject({ code: "EFBIG" });
  const unlimitedLength = await runInContext(`collector.collectBytes((async function* () {
    yield new Uint8Array(17 * 1024 * 1024);
  })(), { maxBytes: 64 * 1024 * 1024 }).then(bytes => bytes.length)`, context);
  expect(unlimitedLength).toBe(17 * 1024 * 1024);
  await expect(runInContext(`collector.collectBytes((async function* () {
    yield new Uint8Array(9);
  })(), { maxMemoryBytes: 16 })`, context)).rejects.toMatchObject({ code: "EFBIG" });
  const result = await runInContext(`collector.collectBytes((async function* () {
    yield new Uint8Array(8);
  })(), { maxMemoryBytes: 16 })`, context) as Uint8Array;
  expect(result.length).toBe(8);
});
