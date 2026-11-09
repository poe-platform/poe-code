import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { auAst } from "./containers/au.js";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { MediaBudgetTracker } from "./types.js";

const raw = rawAudioAsts().find(plugin => plugin.id === "s16le")!;
const pcm = new Uint8Array(1024);
const view = new DataView(pcm.buffer);
for (let i = 0; i < 512; i++) view.setInt16(i * 2, (i * 2003 % 50000) - 25000, true);

it("writes native G.726 little-endian AU bytes with the default bitrate", () => {
  const doc = raw.parse(pcm, { sampleRate: 8000, channels: 1 });
  const expected = readFileSync(new URL("./fixtures/g726le32000.au", import.meta.url));
  assert.deepEqual(Buffer.from(auAst().serialize(doc, { audioCodec: "g726le" })), expected);
  const streamed = auAst().serialize(doc, { audioCodec: "g726le", seekable: false });
  assert.equal(new DataView(streamed.buffer).getUint32(8), 0xffffffff);
  assert.deepEqual(streamed.subarray(32), new Uint8Array(expected.subarray(32)));
});

it("rejects unsupported AU G.726 settings and enforces resource budgets", () => {
  const au = auAst();
  const doc = raw.parse(pcm, { sampleRate: 8000, channels: 1 });
  assert.throws(() => au.serialize(doc, { audioCodec: "g726" }), /Unsupported AU/);
  assert.throws(() => au.serialize(doc, { audioCodec: "g726le", audioBitrate: 24000 }), /32000/);
  assert.throws(() => au.serialize(raw.parse(pcm, { sampleRate: 8000, channels: 2 }), { audioCodec: "g726le" }), /mono/);
  assert.throws(() => au.serialize(raw.parse(pcm, { sampleRate: 16000, channels: 1 }), { audioCodec: "g726le" }), /8000/);
  assert.throws(() => au.serialize(doc, { audioCodec: "g726le", budget: new MediaBudgetTracker({ maxMemoryBytes: 1 }) }), /limit/i);
  assert.throws(() => au.serialize(doc, { audioCodec: "g726le", budget: new MediaBudgetTracker({ maxOutputBytes: 1 }) }), /limit/i);
});
