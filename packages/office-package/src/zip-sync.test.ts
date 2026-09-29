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
