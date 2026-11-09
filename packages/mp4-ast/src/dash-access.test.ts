import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { parseMp4, serializeDashDocument } from "./index.js";

const source = parseMp4(readFileSync(new URL("./fixtures/dash-priming.mp4", import.meta.url)));

function accessAttributes(manifest: Uint8Array) {
  const period = parseXml(new TextDecoder().decode(manifest)).children.find(node => node.localName === "Period")!;
  return period.children.filter(node => node.localName === "AdaptationSet").map(node =>
    Object.fromEntries(node.attributes.filter(attribute =>
      ["contentType", "startWithSAP", "segmentAlignment", "bitstreamSwitching"].includes(attribute.localName)
    ).map(attribute => [attribute.localName, attribute.value])));
}

// Native FFmpeg 7.0.2: -i dash-priming.mp4 -map 0 -c copy -f dash -seg_duration 1 out.mpd.
for (const options of [{}, { singleFile: true }, { useTemplate: false }, { windowSize: 2 }]) {
  it(`advertises native H.264/AAC DASH access flags with ${JSON.stringify(options)}`, () => {
    const { manifest } = serializeDashDocument(source, { ...options, segmentDuration: 1 });
    assert.deepEqual(accessAttributes(manifest), ["video", "audio"].map(contentType => ({
      contentType, startWithSAP: "1", segmentAlignment: "true", bitstreamSwitching: "true"
    })));
  });
}

it("does not advertise independent access for video beginning between keyframes", () => {
  const track = source.tracks[0]!;
  const { manifest } = serializeDashDocument({ ...source, tracks: [{ ...track,
    samples: track.samples.slice(1)
  }] }, { segmentDuration: 1 });
  assert.deepEqual(accessAttributes(manifest), [{ contentType: "video", segmentAlignment: "true" }]);
});

it("checks every audio segment start before advertising independent access", () => {
  const track = source.tracks[1]!;
  const { manifest } = serializeDashDocument({ ...source, tracks: [{ ...track,
    samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index === 0 }))
  }] }, { segmentDuration: 1 });
  assert.deepEqual(accessAttributes(manifest), [{ contentType: "audio", segmentAlignment: "true" }]);
});

it("checks every representation in a grouped adaptation set", () => {
  const track = source.tracks[0]!;
  const { manifest } = serializeDashDocument({ ...source, tracks: [track, { ...track,
    id: 3, samples: track.samples.slice(1)
  }] }, { segmentDuration: 1, adaptationSets: "id=0,streams=v" });
  assert.deepEqual(accessAttributes(manifest), [{ contentType: "video", segmentAlignment: "true" }]);
});

it("does not infer access guarantees for unrelated codecs from keyframe flags", () => {
  const track = source.tracks[1]!;
  const { manifest } = serializeDashDocument({ ...source, tracks: [{ ...track,
    codecDescriptions: track.codecDescriptions.map(description => ({ ...description, codecName: "mp3" as const }))
  }] }, { segmentDuration: 1 });
  assert.deepEqual(accessAttributes(manifest), [{ contentType: "audio", segmentAlignment: "true" }]);
});
