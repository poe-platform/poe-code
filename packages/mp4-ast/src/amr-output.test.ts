import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry, parseMp4, type MediaDocument } from "./index.js";

const registry = createMediaAstRegistry(allMediaAsts());
const documents = ["nb", "wb"].map(band => parseMp4(
  readFileSync(new URL(`./fixtures/amr-copy-${band}.3gp`, import.meta.url)), { decodeAudio: false }
));

for (const [index, band] of ["nb", "wb"].entries()) {
  it(`serializes ${band} packets with the native AMR header and payload`, () => {
    const doc = documents[index]!;
    const codec = doc.tracks[0]!.codecDescriptions[0]!;
    assert.equal(codec.codecName, `amr_${band}`);
    assert.equal(codec.sampleRate, band === "nb" ? 8000 : 16000);
    assert.equal(codec.channels, 1);
    assert.equal(doc.tracks[0]!.decodedAudio, undefined);
    const plugin = registry.findByFilename("out.amr");
    assert.ok(plugin);
    assert.equal(plugin, registry.findByFormatName("amr"));
    const expected = readFileSync(new URL(`./fixtures/amr-copy-${band}.amr`, import.meta.url));
    assert.deepEqual(Buffer.from(plugin.serialize(doc, { audioCodec: "copy" })), expected);
    assert.throws(() => plugin.serialize(doc, { limits: { maxOutputBytes: expected.length - 1 } }), /maxOutputBytes/);
    assert.throws(() => plugin.serialize(doc, { limits: { maxMemoryBytes: expected.length - 1 } }), /maxMemoryBytes/);
    assert.throws(() => plugin.serialize(doc, { limits: { maxCpuMs: -1 } }), /maxCpuMs/);
  });
}

it("rejects incompatible streams and sample descriptions instead of writing misleading AMR headers", () => {
  const plugin = registry.findByFormatName("amr");
  assert.ok(plugin);
  const doc = documents[0]!;
  const track = doc.tracks[0]!;
  const codec = track.codecDescriptions[0]!;
  const invalid: MediaDocument[] = [
    { ...doc, tracks: [] },
    { ...doc, tracks: [track, track] },
    { ...doc, tracks: [{ ...track, type: "video" }] },
    { ...doc, tracks: [{ ...track, codecDescriptions: [{ ...codec, codecName: "aac" }] }] },
    { ...doc, tracks: [{ ...track, codecDescriptions: [{ ...codec, channels: 2 }] }] },
    { ...doc, tracks: [{ ...track, codecDescriptions: [codec, documents[1]!.tracks[0]!.codecDescriptions[0]!] }] }
  ];
  for (const input of invalid) assert.throws(() => plugin.serialize(input), /AMR/);
});
