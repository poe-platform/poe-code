import assert from "node:assert/strict";
import { it } from "node:test";
import { nutAst } from "./containers/nut.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { MediaBudgetTracker } from "./types.js";

const raw = rawAudioAsts().find(plugin => plugin.id === "s16le")!;
const pcm = Uint8Array.from({ length: 24000 }, (_, i) => i % 256);
const doc = raw.parse(pcm, { sampleRate: 8000, channels: 2, decodeAudio: false });

it("writes NUT PCM copy without decoding, including multiple syncpoints", () => {
  const ast = nutAst();
  assert.equal(ast.canMux, true);
  const bytes = ast.serialize(doc, { audioCodec: "copy" });
  const result = ast.parse(bytes, { decodeAudio: false });
  assert.equal(result.tracks[0]!.codecDescriptions[0]!.codecName, "pcm_s16le");
  assert.equal(result.durationSeconds, doc.durationSeconds);
  assert.deepEqual(Buffer.concat(result.tracks[0]!.samples.map(sample => sample.data)), Buffer.from(pcm));
  assert.equal(ast.probe(bytes).streams[0]!.channels, 2);
});

it("bounds NUT output and rejects unsupported streams", () => {
  assert.throws(() => nutAst().serialize(doc, { audioCodec: "copy", budget: new MediaBudgetTracker({ maxOutputBytes: 100 }) }), /limit/i);
  assert.throws(() => nutAst().serialize({ ...doc, tracks: [] }), /audio/);
  assert.throws(() => nutAst().serialize(doc, { audioCodec: "aac" }), /Unsupported NUT/);
});
