import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, oggAst, wavAst } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";

it("refines FLAC LPC quantization without growing frames or losing 24-bit PCM", () => {
  const data = Float64Array.from({ length: 4097 }, (_, i) => (i * 37781 % 16000000 - 8000000) / 2 ** 23);
  const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 16000 }, { bitsPerSample: 24 }));
  for (const plugin of [flacAst(), oggAst()]) {
    for (const lpcType of ["levinson", "cholesky"]) for (const lpcCoeffPrecision of [1, 8, 15]) {
      const frames: Buffer[] = [];
      for (const multiDimQuant of [0, 1]) {
        const bytes = plugin.serialize(doc, { audioCodec: "flac", lpcType, lpcCoeffPrecision, multiDimQuant });
        const decoded = flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes);
        assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData[0], data);
        frames.push(Buffer.concat(decoded.tracks[0]!.samples.map(sample => sample.data)));
        if (!multiDimQuant) assert.deepEqual(bytes, plugin.serialize(doc, { audioCodec: "flac", lpcType, lpcCoeffPrecision }));
      }
      assert.ok(frames[1]!.length <= frames[0]!.length);
    }
    for (const lpcType of ["none", "fixed"]) {
      const options = { audioCodec: "flac", lpcType };
      assert.deepEqual(plugin.serialize(doc, { ...options, multiDimQuant: 1 }), plugin.serialize(doc, options));
    }
    for (const multiDimQuant of [-1, 2, 1.5, NaN, Infinity]) {
      assert.throws(() => plugin.serialize(doc, { audioCodec: "flac", multiDimQuant }), /multi_dim_quant/);
    }
  }
});
