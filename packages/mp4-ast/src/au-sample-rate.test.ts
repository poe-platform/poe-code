import assert from "node:assert/strict";
import { it } from "node:test";
import { auAst } from "./containers/au.js";

for (const encoding of [3, 23, 24, 25, 26]) {
  for (const sampleRate of [0, 8000, 1000000, 0x7fffffff, 0x80000000, 0xffffffff]) {
    it(`validates AU sample rate ${sampleRate} for encoding ${encoding} when parsing and probing`, () => {
      const input = Buffer.from("2e736e6400000018000000080000000300001f40000000010064ff38012cfe70", "hex");
      input.writeUInt32BE(encoding, 12);
      input.writeUInt32BE(sampleRate, 16);
      const ast = auAst();
      for (const decodeAudio of [false, true]) {
        if (sampleRate === 0 || sampleRate > 0x7fffffff) {
          assert.throws(() => ast.parse(input, { decodeAudio }), /sample rate/);
        } else {
          assert.equal(ast.parse(input, { decodeAudio }).tracks[0]!.timescale, sampleRate);
        }
      }
      if (sampleRate === 0 || sampleRate > 0x7fffffff) {
        assert.throws(() => ast.probe(input), /sample rate/);
      } else {
        assert.equal(ast.probe(input).streams[0]!.sample_rate, String(sampleRate));
      }
    });
  }
}
