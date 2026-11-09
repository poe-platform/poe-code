import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";

// Native FFmpeg accepts both descriptions and retains the initial 8 kHz mono stream.
const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001064657363000000000000002040cf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c", "hex");

for (const repeatedRate of [16000, 8000]) {
  it(`retains the first CAF description when a ${repeatedRate} Hz description follows`, () => {
    const bytes = Buffer.from(input);
    bytes.writeDoubleBE(repeatedRate, 64);
    const ast = cafAst();
    const doc = ast.parse(bytes);
    assert.equal(doc.durationSeconds, 8 / 8000);
    const audio = doc.tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!), [101, 102, 103, 104, 105, 106, 107, 108].map(value => value / 32768));
    const stream = ast.probe(bytes).streams[0]!;
    assert.equal(stream.sample_rate, "8000");
    assert.equal(stream.channels, 1);
    assert.equal(stream.duration_ts, 8);
  });
}

it("still validates the initial description and bounds of later descriptions", () => {
  const ast = cafAst();
  const bytes = Buffer.from(input);
  bytes.writeBigInt64BE(31n, 12);
  assert.throws(() => ast.parse(bytes), /Invalid CAF description/);
  bytes.writeBigInt64BE(32n, 12);
  bytes.writeBigInt64BE(100n, 56);
  assert.throws(() => ast.parse(bytes), /Invalid CAF chunk bounds/);
});
