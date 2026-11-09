import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";

// Native CAF: eight mono PCM16 samples, then a three-byte free chunk.
const tailfree = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c667265650000000000000003616263", "hex");

for (const trailing of [false, true]) {
  it(`estimates CAF duration through EOF with trailing chunk ${trailing}`, () => {
    const bytes = tailfree.subarray(0, trailing ? 99 : 84);
    const ast = cafAst();
    const doc = ast.parse(bytes);
    assert.equal(doc.duration, trailing ? 16 : 8);
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!),
      [101, 102, 103, 104, 105, 106, 107, 108].map(value => value / 32768));
    assert.deepEqual(ast.serialize(doc, { audioCodec: "copy" }).subarray(68), new Uint8Array(tailfree.subarray(68, 84)));
    const probe = ast.probe(bytes, { showPackets: true });
    assert.equal(probe.streams[0]!.duration_ts, trailing ? 16 : 8);
    assert.equal(probe.streams[0]!.nb_frames, "8");
    assert.deepEqual(probe.packets!.map(({ pts, duration, size }) => ({ pts, duration, size })),
      [{ pts: 0, duration: 8, size: "16" }]);
    const padded = Buffer.concat([Buffer.alloc(7), bytes]);
    assert.deepEqual(ast.probe(padded.subarray(7)), ast.probe(bytes));
  });
}

it("enforces the CAF estimated duration budget without decoding trailing chunks", () => {
  assert.throws(() => cafAst().probe(tailfree, { limits: { maxDurationSeconds: 0.0015 } }), /limit/i);
});
