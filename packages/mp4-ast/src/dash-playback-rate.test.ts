import assert from "node:assert/strict";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { createSyntheticMp4, parseMp4, serializeDashDocument, type SerializeMediaOptions } from "./index.js";

const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 2, frameCount: 4, includeAudio: false }));
const document = { ...source, tracks: source.tracks.map(track => ({
  ...track, samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
})) };

const cases: [SerializeMediaOptions, string[] | undefined][] = [
  [{}, undefined],
  [{ minPlaybackRate: 1, maxPlaybackRate: 1 }, undefined],
  [{ minPlaybackRate: 0.9 }, ["0.90", "1.00"]],
  [{ maxPlaybackRate: 1.1 }, ["1.00", "1.10"]],
  [{ minPlaybackRate: 0.9, maxPlaybackRate: 1.1 }, ["0.90", "1.10"]],
  [{ minPlaybackRate: 0.5, maxPlaybackRate: 1.5 }, ["0.50", "1.50"]],
  [{ minPlaybackRate: 1.1, maxPlaybackRate: 1.2 }, ["1.10", "1.20"]],
  [{ minPlaybackRate: 1.1 }, undefined],
  [{ maxPlaybackRate: 0.9 }, undefined]
];

for (const [options, expected] of cases) {
  it(`serializes DASH playback bounds: ${JSON.stringify(options)}`, () => {
    const output = serializeDashDocument(document, { segmentDuration: 1, ...options });
    const root = parseXml(new TextDecoder().decode(output.manifest));
    const service = root.children.find(child => child.localName === "ServiceDescription");
    const rate = service?.children.find(child => child.localName === "PlaybackRate");
    assert.deepEqual(rate && ["min", "max"].map(name => rate.attributes.find(attribute => attribute.localName === name)?.value), expected);
    if (expected) {
      assert.equal(service?.attributes.find(attribute => attribute.localName === "id")?.value, "0");
      assert.ok(root.children.indexOf(service!) < root.children.findIndex(child => child.localName === "Period"));
    }
    assert.ok(root.children.some(child => child.localName === "Period"));
  });
}

for (const option of ["minPlaybackRate", "maxPlaybackRate"] as const) {
  for (const value of [0.49, 1.51, NaN, Infinity]) {
    it(`rejects invalid DASH ${option} ${value}`, () => {
      assert.throws(() => serializeDashDocument(document, { [option]: value }), /Invalid DASH playback rate/);
    });
  }
}
