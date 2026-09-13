import { expect, it } from "vitest";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";

it.each([10, 20])("reads original stored entries declaring extraction version %s", (version) => {
  const payload = new TextEncoder().encode("A small original entry");
  const bytes = storedArchive([{ name: "note.txt", bytes: payload }]);
  const view = new DataView(bytes.buffer);
  const central = view.getUint32(bytes.length - 22 + 16, true);
  view.setUint16(4, version, true);
  view.setUint16(central + 6, version, true);
  expect(inspectZip(bytes)).toEqual([expect.objectContaining({ name: "note.txt", payload })]);
});

it("rejects disagreeing local and central extraction versions", () => {
  const bytes = storedArchive([{ name: "note.txt", bytes: new Uint8Array() }]);
  new DataView(bytes.buffer).setUint16(4, 10, true);
  expect(() => inspectZip(bytes)).toThrow();
});
