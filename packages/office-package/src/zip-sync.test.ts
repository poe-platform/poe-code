import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { createStoredZipArchive, readZipArchiveEntries } from "./zip-sync.js";

it("reads stored and raw deflated office entries from a sliced byte view", () => {
  const bytes = new TextEncoder().encode("Unicode résumé\n");
  const stored = createStoredZipArchive({ "note.txt": bytes });
  expect(readZipArchiveEntries(stored).get("note.txt")).toEqual(bytes);
  const compressed = deflateRawSync(bytes);
  const archive = createStoredZipArchive({ "note.txt": compressed });
  const view = new DataView(archive.buffer);
  const central = view.getUint32(archive.length - 6, true);
  view.setUint16(8, 8, true);
  view.setUint32(22, bytes.length, true);
  view.setUint16(central + 10, 8, true);
  view.setUint32(central + 24, bytes.length, true);
  const padded = new Uint8Array(archive.length + 8);
  padded.set(archive, 3);
  expect(readZipArchiveEntries(padded.subarray(3, 3 + archive.length)).get("note.txt")).toEqual(bytes);
});

it("retains entry-header and data bounds failures", () => {
  expect(() => readZipArchiveEntries(new Uint8Array())).toThrow("missing end of central directory");
  const archive = createStoredZipArchive({ file: Uint8Array.of(1, 2, 3) });
  const view = new DataView(archive.buffer);
  const central = view.getUint32(archive.length - 6, true);
  view.setUint32(central + 42, archive.length, true);
  expect(() => readZipArchiveEntries(archive)).toThrow("invalid entry header");
});

it.each([
  {input: [], error: "buffer error"},
  {input: [3], error: "buffer error"},
  {input: [7], error: "invalid block type"},
  {input: [255, 255], error: "invalid block type"},
  {input: [3, 0]},
  {input: [3, 0, 9]}
])("preserves raw DEFLATE admission and diagnostics for $input", ({input, error}) => {
  const archive = createStoredZipArchive({file: Uint8Array.from(input)});
  const view = new DataView(archive.buffer), central = view.getUint32(archive.length - 6, true);
  view.setUint16(8, 8, true);
  view.setUint16(central + 10, 8, true);
  if (error) {
    let failure: unknown;
    try {readZipArchiveEntries(archive);} catch (caught) {failure = caught;}
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe("Error");
    expect((failure as Error).message).toBe(error);
  } else expect(readZipArchiveEntries(archive).get("file")).toEqual(new Uint8Array());
});

it("bundles raw ZIP byte access into a self-contained Worker without private installs", async () => {
  const result = await build({entryPoints: [fileURLToPath(new URL("./zip-sync.ts", import.meta.url))], bundle: true,
    platform: "browser", conditions: ["workerd"], format: "iife", globalName: "office", write: false, metafile: true});
  for (const output of Object.values(result.metafile!.outputs)) expect(output.imports).toEqual([]);
  const runtime = runInNewContext(`${result.outputFiles[0]!.text};office`, {Uint8Array, TextEncoder, TextDecoder});
  const plain = new TextEncoder().encode("Independent raw DEFLATE résumé"), compressed = deflateRawSync(plain);
  const archive = runtime.createStoredZipArchive({file: compressed}) as Uint8Array;
  const view = new DataView(archive.buffer), central = view.getUint32(archive.length - 6, true);
  view.setUint16(8, 8, true); view.setUint16(central + 10, 8, true);
  expect(runtime.readZipArchiveEntries(archive).get("file")).toEqual(plain);
});
