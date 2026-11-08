import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, wavAst, oggAst } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";

it("preserves silence, extrema, noisy 24-bit PCM and a one-sample tail with every predictor", () => {
  let seed = 123;
  const data = Float64Array.from({ length: 4097 }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return i < 2048 ? 0 : i % 3 === 0 ? -1 : i % 3 === 1 ? 1 - 2 ** -23 : (seed >> 8) / 2 ** 23;
  });
  const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 16000 }, { bitsPerSample: 24 }));
  for (const lpcType of ["none", "fixed", "levinson", "cholesky"]) {
    for (const plugin of [flacAst(), oggAst()]) {
      const output = plugin.serialize(doc, { audioCodec: "flac", lpcType });
      assert.deepEqual(Array.from(flacAst().parse(plugin.id === "ogg" ? extractOggFlac(output)! : output).tracks[0]!.decodedAudio!.channelData[0]!), Array.from(data));
    }
  }
});
