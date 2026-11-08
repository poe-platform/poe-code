import assert from "node:assert/strict";
import { it } from "node:test";
import { wavAst } from "./containers/adapters.js";
import { readWavHeader } from "./containers/wav-header.js";

const native = Buffer.from("726966662e91cf11a5d628db04c10000800000000000000077617665f3acd3118cd100c04f8edb8a666d7420f3acd3118cd100c04f8edb8a280000000000000001000100401f0000803e00000200100064617461f3acd3118cd100c04f8edb8a30000000000000000080ffbffffeffff0000010001010140ff7f000000000000", "hex");

for (const channels of [1, 2]) {
  for (const frames of [4, 5]) {
    for (const codec of ["pcm_f32le", "pcm_f64le", "pcm_mulaw", "pcm_alaw", "pcm_s16le"]) {
      it(`writes native Wave64 fact layout for ${codec}, ${channels} channels and ${frames} frames`, () => {
        const ast = wavAst("w64");
        const doc = ast.parse(native);
        const track = doc.tracks[0]!;
        const output = Buffer.from(ast.serialize({ ...doc, tracks: [{ ...track,
          codecDescriptions: [{ ...track.codecDescriptions[0]!, channels }],
          decodedAudio: { ...track.decodedAudio!, channelData: Array.from({ length: channels }, () =>
            new Float32Array([10, -20, 30, -40, 50].slice(0, frames).map(value => value / 32768))) }
        }] }, { audioCodec: codec }));
        const header = readWavHeader(output);
        if (codec === "pcm_s16le") {
          assert.equal(header.factOffset, undefined);
        } else {
          assert.equal(header.factSize, 8);
          assert.equal(output.readBigUInt64LE(header.factOffset! - 8), 32n);
          assert.equal(output.subarray(header.factOffset! - 24, header.factOffset! - 8).toString("hex"),
            "66616374f3acd3118cd100c04f8edb8a");
          assert.equal(output.readBigUInt64LE(header.factOffset!), BigInt(frames));
        }
        assert.equal(output.readBigUInt64LE(16), BigInt(output.length));
        assert.deepEqual(ast.serialize(ast.parse(output, { decodeAudio: false }), { audioCodec: "copy" }),
          new Uint8Array(output));
      });
    }
  }
}
