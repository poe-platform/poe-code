import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, wavAst, oggAst } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";

it("uses level 5 for omitted and default FLAC compression in raw and Ogg output", () => {
  const channels = [
    Float64Array.from({ length: 16 }, (_, i) => (i * 751 - 6000) / 32768),
    Float64Array.from({ length: 16 }, (_, i) => (8311 - 632 * i) / 32768)
  ];
  const doc = wavAst().parse(encodeWav({ channels, sampleRate: 8000 }));
  for (const plugin of [flacAst(), oggAst()]) {
    const explicit = plugin.serialize(doc, { audioCodec: "flac", compressionLevel: 5 });
    for (const compressionLevel of [undefined, -1]) {
      const output = plugin.serialize(doc, { audioCodec: "flac", compressionLevel });
      assert.deepEqual(output, explicit, `${plugin.id} level ${compressionLevel}`);
      const decoded = flacAst().parse(plugin.id === "ogg" ? extractOggFlac(output)! : output);
      assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData, channels);
    }
  }
});

it("higher levels improve compression when higher-order prediction benefits the PCM", () => {
  const data = Float64Array.from({ length: 48 }, (_, i) => i ** 4 / 2 ** 23);
  const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 8000 }, { bitsPerSample: 24 }));
  const sizes = [5, 8, 12].map(compressionLevel => {
    const output = flacAst().serialize(doc, { compressionLevel });
    assert.deepEqual(flacAst().parse(output).tracks[0]!.decodedAudio!.channelData[0], data);
    return output.length;
  });
  assert.ok(sizes[0]! > sizes[1]!);
  assert.ok(sizes[1]! > sizes[2]!);
});

it("compresses Ogg FLAC and preserves silence, extrema and noisy PCM at every level", () => {
  let seed = 123;
  const data = Float64Array.from({ length: 4097 }, (_, i) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return i < 2048 ? 0 : i % 3 === 0 ? -1 : i % 3 === 1 ? 1 - 2 ** -23 : (seed >> 8) / 2 ** 23;
  });
  const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 16000 }, { bitsPerSample: 24 }));
  for (let compressionLevel = 0; compressionLevel <= 12; compressionLevel++) {
    for (const plugin of [flacAst(), oggAst()]) {
      const output = plugin.serialize(doc, { audioCodec: "flac", compressionLevel });
      assert.deepEqual(Array.from(flacAst().parse(plugin.id === "ogg" ? extractOggFlac(output)! : output).tracks[0]!.decodedAudio!.channelData[0]!), Array.from(data));
    }
  }
});
