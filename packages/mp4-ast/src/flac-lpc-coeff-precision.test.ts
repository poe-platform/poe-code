import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, oggAst, wavAst } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";

it("quantizes LPC coefficients at every precision without losing 24-bit PCM", () => {
  const data = Float64Array.from({ length: 4097 }, (_, i) => (i * 101 - 200000) / 2 ** 23);
  const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 16000 }, { bitsPerSample: 24 }));
  for (const plugin of [flacAst(), oggAst()]) {
    for (const lpcType of ["levinson", "cholesky"]) {
      const outputs: Uint8Array[] = [];
      for (let lpcCoeffPrecision = 0; lpcCoeffPrecision <= 15; lpcCoeffPrecision++) {
        const bytes = plugin.serialize(doc, { audioCodec: "flac", lpcType, lpcCoeffPrecision });
        const decoded = flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes);
        assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData[0], data);
        const packet = decoded.tracks[0]!.samples[0]!.data;
        const type = (packet[8]! >> 1) & 63;
        if (type === 32) assert.equal((packet[12]! >> 4) + 1, lpcCoeffPrecision || 15);
        else assert.equal(type, 1); // Low-precision prediction can cost more than verbatim.
        if (lpcCoeffPrecision >= 8) assert.equal(type, 32);
        outputs.push(bytes);
      }
      assert.deepEqual(outputs[0], outputs[15]);
      assert.notDeepEqual(outputs[8], outputs[15]);
      assert.deepEqual(outputs[15], plugin.serialize(doc, { audioCodec: "flac", lpcType }));
    }
    for (const lpcType of ["none", "fixed"]) {
      const options = { audioCodec: "flac", lpcType };
      assert.deepEqual(plugin.serialize(doc, { ...options, lpcCoeffPrecision: 8 }), plugin.serialize(doc, options));
    }
    for (const lpcCoeffPrecision of [-1, 16, 1.5, NaN, Infinity]) {
      assert.throws(() => plugin.serialize(doc, { audioCodec: "flac", lpcCoeffPrecision }), /lpc_coeff_precision/);
    }
  }
});
