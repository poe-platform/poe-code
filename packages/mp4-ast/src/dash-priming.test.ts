import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { concatBytes, parseMp4, parseStreamingManifest, serializeDashDocument } from "./index.js";

const source = parseMp4(new Uint8Array(readFileSync(new URL("./fixtures/dash-priming.mp4", import.meta.url))));

// Native FFmpeg 7.0.2: -i av.mp4 -map 0 -c copy -f dash -seg_duration 1 out.mpd.
for (const options of [
  {},
  { useTemplate: false },
  { singleFile: true },
  { mediaSegmentName: "part-$RepresentationID$-$Time$.m4s" },
  { windowSize: 2 }
]) {
  it(`excludes AAC priming from the DASH timeline with ${JSON.stringify(options)}`, () => {
    const { manifest, resources } = serializeDashDocument(source, { segmentDuration: 1, ...options });
    const adaptations = parseXml(new TextDecoder().decode(manifest)).children[0]!.children;
    const timelines = adaptations.map(adaptation => {
      const representation = adaptation.children[0]!;
      const template = representation.children.find(child => child.localName === "SegmentTemplate" || child.localName === "SegmentList")!;
      const timeline = template.children.find(child => child.localName === "SegmentTimeline")!;
      return timeline.children.flatMap(entry => {
        const attributes = Object.fromEntries(entry.attributes.map(attribute => [attribute.localName, Number(attribute.value)]));
        return Array.from({ length: (attributes.r ?? 0) + 1 }, (_, index) => [attributes.t! + index * attributes.d!, attributes.d!]);
      });
    });
    assert.deepEqual(timelines[0], [[0, 16384], [16384, 16384], [32768, 16384], [49152, 16384]].slice(options.windowSize ? -2 : 0));
    assert.deepEqual(timelines[1], [[0, 47104], [47104, 48128], [95232, 48128], [143360, 48128], [191488, 512]].slice(options.windowSize ? -2 : 0));
    assert.equal(timelines[1]!.at(-1)![0]! + timelines[1]!.at(-1)![1]!, 192000);

    if (options.singleFile) {
      for (const [index, track] of source.tracks.entries()) {
        const output = parseMp4(resources.get(`stream${index}.mp4`)!).tracks[0]!;
        assert.deepEqual(output.editList, track.editList);
        assert.deepEqual(output.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]),
          track.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]));
      }
    } else {
      const plan = parseStreamingManifest(manifest, "dash");
      for (const [index, sequence] of plan.sequences.entries()) {
        const track = source.tracks[index]!;
        const output = parseMp4(concatBytes([resources.get(sequence[0]!.initialization!)!, ...sequence.map(part => {
          assert.ok(resources.has(part.uri), part.uri);
          return resources.get(part.uri)!;
        })])).tracks[0]!;
        assert.deepEqual(output.editList, track.editList);
        assert.deepEqual(output.samples.map(sample => [sample.dts, sample.pts, sample.duration, sample.data]),
          track.samples.slice(options.windowSize ? -output.samples.length : 0).map(sample => [sample.dts, sample.pts, sample.duration, sample.data]));
        if (index === 1 && !options.windowSize) assert.equal(output.samples.length, 189);
      }
    }
  });
}

it("keeps the full audio timeline when no priming edit is present", () => {
  const doc = { ...source, tracks: source.tracks.map(track => ({ ...track, editList: undefined })) };
  const { manifest } = serializeDashDocument(doc, { segmentDuration: 1 });
  assert.ok(new TextDecoder().decode(manifest).includes('<S t="0" d="48128" r="3"/><S t="192512" d="512"/>'));
});
