import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi, serializeAvi } from "./containers/avi.js";

const input = new Uint8Array(readFileSync(new URL("./fixtures/stream-names.avi", import.meta.url)));
const doc = parseAvi(input);

it("uses the same AVI reservation by default and for zero", () => {
  assert.deepEqual(serializeAvi(doc), serializeAvi(doc, { reserveIndexSpace: 0 }));
});

it("rejects invalid AVI reservation sizes", () => {
  for (const reserveIndexSpace of [-1, 1.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => serializeAvi(doc, { reserveIndexSpace }), /Invalid reserve_index_space/);
  }
});

it("checks resource limits before allocating AVI index reservations", () => {
  for (const limits of [{ maxOutputBytes: 50000 }, { maxMemoryBytes: 50000 }]) {
    assert.throws(() => serializeAvi(doc, { reserveIndexSpace: 2147483647, limits }), /limit/i);
  }
});

it("retains AAC decoder configuration so reserved AVI outputs remain decodable", () => {
  // The native fixture's AAC AudioSpecificConfig follows the 18-byte WAVEFORMATEX.
  const bytes = Buffer.from(input);
  const strf = bytes.indexOf("strf");
  const config = input.slice(strf + 8 + 18, strf + 8 + bytes.readUInt32LE(strf + 4));
  assert.ok(config.length > 0);
  assert.deepEqual(doc.tracks[0]!.codecDescriptions[0]!.esds?.decoderSpecificInfo, config);
  const output = parseAvi(serializeAvi(doc, { reserveIndexSpace: 30000 }));
  assert.deepEqual(output.tracks[0]!.codecDescriptions[0]!.esds?.decoderSpecificInfo, config);
});
