import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000400000002000000010000001064617461000000000000000c000000000064ff38012cfe70", "hex");

it("decodes and copies CAF LPCM with two frames per packet", () => {
  const ast = cafAst();
  const raw = rawAudioAsts().find(plugin => plugin.id === "s16le")!;
  assert.deepEqual(raw.serialize(ast.parse(input)), new Uint8Array(Buffer.from("640038ff2c0170fe", "hex")));
  const doc = ast.parse(input, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.deepEqual(ast.serialize(doc, { audioCodec: "copy" }).subarray(68), new Uint8Array(input.subarray(68)));
  assert.deepEqual(doc.tracks[0]!.samples.map(({ offset, size, duration, pts }) => ({ offset, size, duration, pts })), [
    { offset: 68, size: 4, duration: 2, pts: 0 },
    { offset: 72, size: 4, duration: 2, pts: 2 }
  ]);
  const probe = ast.probe(input, { showPackets: true });
  assert.equal(probe.streams[0]!.duration_ts, 4);
  assert.deepEqual(probe.packets!.map(({ pos, size, duration }) => ({ pos, size, duration })), [
    { pos: "68", size: "4", duration: 2 },
    { pos: "72", size: "4", duration: 2 }
  ]);
});

it("validates fixed CAF packet sizes and packet budgets", () => {
  for (const [offset, value] of [[36, 3], [40, 0]]) {
    const bytes = Buffer.from(input);
    bytes.writeUInt32BE(value!, offset!);
    assert.throws(() => cafAst().parse(bytes), /encoding/);
  }
  assert.throws(() => cafAst().parse(input, { limits: { maxSamplesPerTrack: 1 } }), /limit/i);
});
