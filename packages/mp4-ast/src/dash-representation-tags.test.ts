import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, dashAst } from "./index.js";

for (const addressing of ["SegmentTemplate", "SegmentList", "BaseURL"]) {
  it(`exposes DASH representation tags with ${addressing}`, () => {
    const media = createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: false });
    const representations = [
      { id: "video-main", bandwidth: "11176" },
      { id: "0", bandwidth: "4000" },
      {}
    ];
    const xml = representations.map(({ id, bandwidth }) => {
      const location = addressing === "SegmentTemplate"
        ? '<SegmentTemplate media="video.mp4" duration="1"/>'
        : addressing === "SegmentList"
          ? '<SegmentList><SegmentURL media="video.mp4"/></SegmentList>'
          : '<BaseURL>video.mp4</BaseURL>';
      return `<Representation${id === undefined ? "" : ` id="${id}"`}${bandwidth === undefined ? "" : ` bandwidth="${bandwidth}"`}>${location}</Representation>`;
    }).join("");
    const manifest = new TextEncoder().encode(`<MPD mediaPresentationDuration="PT1S"><Period><AdaptationSet>${xml}</AdaptationSet></Period></MPD>`);
    const probe = dashAst().probe(manifest, { resolveResource: () => media });
    assert.equal(probe.streams.length, 3);
    for (const [index, stream] of probe.streams.entries()) {
      assert.equal(stream.tags?.id, representations[index]!.id);
      assert.equal(stream.tags?.variant_bitrate, representations[index]!.bandwidth);
      assert.equal(stream.tags?.language, "und");
      assert.equal(stream.tags?.handler_name, "VideoHandler");
    }
  });
}
