import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, oggAst, wavAst } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";

it("selects estimated or exact Rice parameters for FLAC and Ogg FLAC without changing PCM", () => {
  const channels = [0, 1].map(channel => Float64Array.from({ length: 4097 }, (_, i) =>
    (i * 149 % 30000 - 15000 + channel * (i % 31 - 15)) / 32768));
  const doc = wavAst().parse(encodeWav({ channels, sampleRate: 16000 }));
  for (const plugin of [flacAst(), oggAst()]) {
    const outputs = [undefined, 0, 1].map(exactRiceParameters => {
      const bytes = plugin.serialize(doc, { audioCodec: "flac", compressionLevel: 5, lpcType: "levinson", exactRiceParameters });
      const decoded = flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes);
      assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData, channels);
      return bytes;
    });
    assert.deepEqual(outputs[0], outputs[1]);
    assert.equal(Buffer.from(outputs[1]!).equals(outputs[2]!), false);
    assert.ok(outputs[2]!.length <= outputs[1]!.length);
    for (const exactRiceParameters of [-1, 2, 0.5, NaN, Infinity]) {
      assert.throws(() => plugin.serialize(doc, { audioCodec: "flac", compressionLevel: 5, lpcType: "levinson", exactRiceParameters }), /exact_rice_parameters/);
    }
  }
});
