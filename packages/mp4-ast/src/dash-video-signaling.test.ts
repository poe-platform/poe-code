import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeDashDocument } from "./index.js";

for (const [sarWidth, sarHeight, sar, par] of [
  [1, 1, "1:1", "4:3"],
  [8, 6, "4:3", "16:9"],
  [undefined, undefined, "1:1", "4:3"]
] as const) {
  for (const [timescale, duration, frameRate] of [[4, 1, "4/1"], [30000, 1001, "30000/1001"]] as const) {
    it(`signals DASH ${frameRate} video with SAR ${sarWidth}:${sarHeight}`, () => {
      const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
      const source = { ...base, tracks: base.tracks.map(track => track.type !== "video" ? track : {
        ...track, timescale, duration: duration * track.samples.length,
        codecDescriptions: track.codecDescriptions.map(description => ({ ...description, sarWidth, sarHeight })),
        samples: track.samples.map((sample, i) => ({ ...sample, dts: i * duration, pts: i * duration, duration }))
      }) };
      const { manifest } = serializeDashDocument(source);
      const sets = new TextDecoder().decode(manifest).split("<AdaptationSet").slice(1);
      assert.ok(sets[0]!.split(">")[0]!.includes(`frameRate="${frameRate}"`), sets[0]);
      assert.ok(sets[0]!.split(">")[0]!.includes(`par="${par}"`), sets[0]);
      assert.ok(sets[0]!.split("<Representation")[1]!.split(">")[0]!.includes(`sar="${sar}"`), sets[0]);
      for (const attribute of ["frameRate=", "par=", "sar="]) assert.ok(!sets[1]!.includes(attribute));
    });
  }
}
