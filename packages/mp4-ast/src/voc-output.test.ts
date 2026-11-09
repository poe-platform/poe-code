import assert from "node:assert/strict";
import { it } from "node:test";
import { vocAst } from "./containers/voc.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { MediaBudgetTracker } from "./types.js";

const raw = rawAudioAsts().find(plugin => plugin.id === "s16le")!;

it("splits VOC sound blocks at complete frames within the 24-bit length limit", () => {
  const data = new Uint8Array(0x1000000);
  data.set([72, 0, 0, 252]);
  data.set([1, 2, 3, 4], data.length - 4);
  const doc = raw.parse(data, { sampleRate: 8000, channels: 2, decodeAudio: false });
  const output = vocAst().serialize(doc, { audioCodec: "copy" });
  const view = new DataView(output.buffer);
  const firstLength = output[27]! + output[28]! * 256 + output[29]! * 65536;
  assert.equal((firstLength - 12) % 4, 0);
  assert.ok(firstLength <= 0xffffff);
  assert.equal(output[30 + firstLength], 9);
  assert.equal(view.getUint32(34 + firstLength, true), 8000);
  const parsed = vocAst().parse(output, { decodeAudio: false });
  const payload = Buffer.concat(parsed.tracks[0]!.samples.map(sample => sample.data));
  assert.deepEqual(payload, Buffer.from(data));
});

it("defaults VOC to PCM16 and enforces output budgets and codec support", () => {
  const doc = raw.parse(new Uint8Array([72, 0, 0, 252]), { sampleRate: 8000, channels: 2 });
  const output = vocAst().serialize(doc);
  assert.deepEqual(output.subarray(42, -1), new Uint8Array([72, 0, 0, 252]));
  assert.throws(() => vocAst().serialize(doc, { audioCodec: "pcm_f32le" }), /Unsupported VOC audio codec/);
  assert.throws(() => vocAst().serialize(doc, {
    budget: new MediaBudgetTracker({ maxOutputBytes: output.length - 1 })
  }), /output/i);
});
