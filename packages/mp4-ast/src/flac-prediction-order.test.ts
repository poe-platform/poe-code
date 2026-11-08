import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, oggAst, wavAst } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";

it("honors LPC order bounds and search strategies with lossless FLAC and Ogg output", () => {
  const data = Float64Array.from({ length: 4097 }, (_, i) => Math.trunc(12000 * Math.sin(i * .074) + 4000 * Math.sin(i * .19)) / 32768);
  const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 16000 }));
  for (const plugin of [flacAst(), oggAst()]) {
    const sizes = new Map<string, number>();
    for (const predictionOrderMethod of ["estimation", "2level", "4level", "8level", "search", "log", "-1", "0", "4", "5"]) {
      const bytes = plugin.serialize(doc, { audioCodec: "flac", minPredictionOrder: 2, maxPredictionOrder: 8, predictionOrderMethod });
      const decoded = flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes);
      assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData[0], data);
      const packets = decoded.tracks[0]!.samples;
      for (const packet of packets.slice(0, -1)) {
        const type = (packet.data[8]! >> 1) & 63;
        assert.ok(type >= 33 && type <= 39, `LPC type ${type}`);
      }
      sizes.set(predictionOrderMethod, packets.reduce((sum, packet) => sum + packet.data.length, 0));
    }
    assert.ok(sizes.get("search")! <= sizes.get("estimation")!);
    assert.ok(new Set(sizes.values()).size > 1, "search methods must affect actual packets");
    assert.equal(sizes.get("search"), sizes.get("4"));
    assert.equal(sizes.get("log"), sizes.get("5"));
    for (const options of [{ minPredictionOrder: 9, maxPredictionOrder: 8 }, { maxPredictionOrder: 33 }, { minPredictionOrder: NaN }, { predictionOrderMethod: "bogus" }]) {
      assert.throws(() => plugin.serialize(doc, { audioCodec: "flac", ...options }), /prediction/);
    }
    for (const options of [{ maxPredictionOrder: 4 }, { minPredictionOrder: 4 }, { minPredictionOrder: -1, maxPredictionOrder: -1 }, { minPredictionOrder: 32, maxPredictionOrder: 32 }]) {
      const bytes = plugin.serialize(doc, { audioCodec: "flac", ...options });
      assert.deepEqual(flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes).tracks[0]!.decodedAudio!.channelData[0], data);
    }
  }
});

it("preserves 24-bit PCM with high-order Cholesky fits, quantization and short tails", () => {
  const data = Float64Array.from({ length: 257 }, (_, i) => (i * 37781 % 16000000 - 8000000) / 2 ** 23);
  const doc = wavAst().parse(encodeWav({ channels: [data], sampleRate: 16000 }, { bitsPerSample: 24 }));
  for (const order of [4, 32]) for (const lpcPasses of [1, 2]) {
    const bytes = flacAst().serialize(doc, { lpcType: "cholesky", minPredictionOrder: order, maxPredictionOrder: order, lpcPasses, frameSize: 256, multiDimQuant: 1 });
    assert.deepEqual(flacAst().parse(bytes).tracks[0]!.decodedAudio!.channelData[0], data);
  }
});
