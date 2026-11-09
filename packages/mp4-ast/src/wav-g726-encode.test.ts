import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav, serializeWav } from "./containers/adapters.js";
import { MediaBudgetTracker } from "./types.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

for (const bits of [2, 3, 4, 5]) {
  it(`encodes ${bits}-bit G.726 matching native FFmpeg bytes`, () => {
    const pcm = new Uint8Array(8192);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < 4096; i++) view.setInt16(i * 2, (i * 331) % 60001 - 30000, true);
    const doc = rawAudioAsts().find(plugin => plugin.id === "s16le")!.parse(pcm, { sampleRate: 8000, channels: 1 });
    const output = serializeWav(doc, { audioCodec: "g726", audioBitrate: bits * 8000 });
    const expected = readFileSync(new URL(`./fixtures/g726-${bits}.wav`, import.meta.url));
    const actualDoc = parseWav(output, { decodeAudio: false });
    const expectedDoc = parseWav(expected, { decodeAudio: false });
    assert.equal(actualDoc.duration, 4096);
    const actual = Buffer.concat(actualDoc.tracks[0]!.samples.map(s => s.data));
    const reference = Buffer.concat(expectedDoc.tracks[0]!.samples.map(s => s.data));
    assert.equal(actual.length, reference.length);
    assert.equal(actual.findIndex((byte, i) => byte !== reference[i]), -1);
  });
}

it("rejects unsupported G.726 channels and sample rates and accounts for memory", () => {
  const raw = rawAudioAsts().find(plugin => plugin.id === "s16le")!;
  const pcm = new Uint8Array(320);
  assert.throws(() => serializeWav(raw.parse(pcm, { sampleRate: 8000, channels: 2 }), { audioCodec: "g726" }), /mono/);
  assert.throws(() => serializeWav(raw.parse(pcm, { sampleRate: 16000, channels: 1 }), { audioCodec: "g726" }), /8000/);
  const doc = raw.parse(pcm, { sampleRate: 8000, channels: 1 });
  assert.throws(() => serializeWav(doc, { audioCodec: "g726", budget: new MediaBudgetTracker({ maxMemoryBytes: 1 }) }), /limit/i);
});
