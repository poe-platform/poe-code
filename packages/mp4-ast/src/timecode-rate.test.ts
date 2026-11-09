import assert from "node:assert/strict";
import { it } from "node:test";
import { buildProbeStream } from "./probe-stream.js";

for (const [timescale, frameDuration] of [[12800, 512], [30000, 1001]] as const) {
  it(`uses the declared ${timescale}/${frameDuration} timecode rate independently of packet statistics`, () => {
    const extraData = new Uint8Array(20);
    const configuration = new DataView(extraData.buffer);
    configuration.setUint32(8, timescale);
    configuration.setUint32(12, frameDuration);
    for (const count of [0, 1, 10]) {
      const stream = buildProbeStream({
        id: 2, type: "data", timescale: 1000, duration: 120, language: "und", enabled: true
      }, { formatFourCC: "tmcd", codecName: "tmcd", codecTagString: "tmcd", extraData }, {
        totalBytes: count * 4, count, ticks: 120, firstPts: 0, hasReorderedSamples: false
      }, 1, "mp4");
      assert.equal(stream.avg_frame_rate, `${timescale}/${frameDuration}`);
      assert.equal(stream.r_frame_rate, "0/0");
    }
  });
}

it("leaves unknown timecode rates unset for absent, truncated or zero configuration", () => {
  for (const extraData of [undefined, new Uint8Array(15), new Uint8Array(20)]) {
    const stream = buildProbeStream({
      id: 2, type: "data", timescale: 1000, duration: 120, language: "und", enabled: true
    }, { formatFourCC: "tmcd", codecName: "tmcd", codecTagString: "tmcd", extraData }, {
      totalBytes: 4, count: 1, ticks: 120, firstPts: 0, hasReorderedSamples: false
    }, 1, "mp4");
    assert.equal(stream.avg_frame_rate, "0/0");
    assert.equal(stream.r_frame_rate, "0/0");
  }
});
