import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, oggAst, wavAst } from "./index.js";
import { extractOggFlac } from "./containers/ogg.js";
import { frameHeader } from "./containers/flac-probe.js";

it("honors Rice partition bounds in FLAC and Ogg FLAC and preserves PCM including short tails", () => {
  const channels = [0, 1].map(channel => Float64Array.from({ length: 4097 }, (_, i) =>
    (i * 149 % 30000 - 15000 + channel * (i % 31 - 15)) / 32768));
  const doc = wavAst().parse(encodeWav({ channels, sampleRate: 16000 }));
  for (const plugin of [flacAst(), oggAst()]) {
    const sizes: number[] = [];
    for (const order of [0, 3, 8]) {
      const bytes = plugin.serialize(doc, { audioCodec: "flac", minPartitionOrder: order, maxPartitionOrder: order });
      const decoded = flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes);
      assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData, channels);
      const packets = decoded.tracks[0]!.samples;
      for (const packet of packets.slice(0, -1)) {
        let bit = frameHeader(packet.data, 0)!.headerSize * 8;
        const read = (width: number): number => {
          let value = 0;
          for (let i = 0; i < width; i++, bit++) value = value * 2 + ((packet.data[bit >>> 3]! >>> (7 - (bit & 7))) & 1);
          return value;
        };
        const type = read(8) >> 1;
        assert.ok(type >= 8, `expected predictor, got ${type}`);
        const predictionOrder = type >= 32 ? type - 31 : type - 8;
        bit += predictionOrder * 16;
        if (type >= 32) { const precision = read(4) + 1; bit += 5 + predictionOrder * precision; }
        assert.equal(read(2), 0);
        assert.equal(read(4), order);
      }
      sizes.push(packets.reduce((sum, packet) => sum + packet.data.length, 0));
    }
    assert.ok(new Set(sizes).size > 1);
    for (const options of [{ maxPartitionOrder: 3 }, { maxPartitionOrder: 0 }, { minPartitionOrder: -1, maxPartitionOrder: -1 }]) {
      const bytes = plugin.serialize(doc, { audioCodec: "flac", ...options });
      assert.deepEqual(flacAst().parse(plugin.id === "ogg" ? extractOggFlac(bytes)! : bytes).tracks[0]!.decodedAudio!.channelData, channels);
    }
    for (const options of [{ minPartitionOrder: 3 }, { minPartitionOrder: 4, maxPartitionOrder: 2 }, { maxPartitionOrder: 9 }, { minPartitionOrder: -2 }, { minPartitionOrder: NaN }, { maxPartitionOrder: 1.5 }]) {
      assert.throws(() => plugin.serialize(doc, { audioCodec: "flac", ...options }), /partition/i);
    }
  }
});
