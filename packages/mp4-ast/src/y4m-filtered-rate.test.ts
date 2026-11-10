import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m, serializeY4m } from "./containers/adapters.js";

for (const [numerator, denominator] of [[15, 2], [30000, 1001], [6, 1], [3, 4]]) {
  for (const keepSamples of [true, false]) {
    it(`writes filtered Y4M rate ${numerator}:${denominator} with ${keepSamples ? "stale" : "no"} samples`, () => {
      const doc = parseY4m(Buffer.concat([
        Buffer.from("YUV4MPEG2 W2 H2 F24:1 Ip A1:1 C420jpeg\nFRAME\n"), Buffer.alloc(6, 128)
      ]));
      const track = doc.tracks[0]!;
      const output = serializeY4m({ ...doc, tracks: [{ ...track,
        decodedVideoFrames: [{ ...track.decodedVideoFrames![0]!, durationSeconds: denominator! / numerator! }],
        samples: keepSamples ? track.samples : []
      }] });
      const header = new TextDecoder().decode(output.subarray(0, output.indexOf(10))).split(" ");
      assert.ok(header.includes(`F${numerator}:${denominator}`), header.join(" "));
      assert.equal(parseY4m(output).tracks[0]!.decodedVideoFrames![0]!.durationSeconds, denominator! / numerator!);
    });
  }
}
