import assert from "node:assert/strict";
import { it } from "node:test";
import { parseXml } from "@poe-code/xml-ast";
import { createSyntheticMp4, MediaLimitExceededError, parseMp4, serializeDashDocument } from "./index.js";

const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 16, includeAudio: true }));
const source = { ...base, metadata: { ...base.metadata, title: "Live & recorded" }, tracks: base.tracks.map(track => ({
  ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
})) };

for (const singleFile of [false, true]) {
  for (const useTemplate of [false, true]) {
    for (const windowSize of [0, 2]) {
      it(`publishes only available DASH resources (single file ${singleFile}, template ${useTemplate}, window ${windowSize})`, () => {
        const output = serializeDashDocument(source, { singleFile, useTemplate, windowSize, segmentDuration: 1,
          hlsPlaylist: true, adaptationSets: "id=2,streams=a id=3,streams=v",
          initSegmentName: "init&$RepresentationID$.mp4", mediaSegmentName: "part&$RepresentationID$-$Time$.m4s" });
        const written = new Map<string, Uint8Array>();
        let publications = 0;
        let finalized = false;
        let availabilityStartTime: string | undefined;
        for (const publication of output.publications()) {
          assert.equal(finalized, false);
          for (const [uri, bytes] of publication.resources) written.set(uri, bytes);
          const text = new TextDecoder().decode(publication.manifest);
          const xml = parseXml(text);
          const finalXml = parseXml(new TextDecoder().decode(output.manifest));
          assert.deepEqual(xml.children.find(child => child.localName === "ProgramInformation"),
            finalXml.children.find(child => child.localName === "ProgramInformation"));
          for (const name of ["profiles", "maxSegmentDuration", "minBufferTime"]) {
            assert.deepEqual(xml.attributes.find(attribute => attribute.localName === name),
              finalXml.attributes.find(attribute => attribute.localName === name));
          }
          const type = xml.attributes.find(attribute => attribute.localName === "type")!.value;
          finalized = type === "static";
          if (!finalized) {
            const start = xml.attributes.find(attribute => attribute.localName === "availabilityStartTime")!.value;
            availabilityStartTime ??= start;
            assert.equal(start, availabilityStartTime);
            assert.ok(Number.isFinite(Date.parse(start)));
            assert.ok(!written.has("master.m3u8"));
          }
          const adaptations = xml.children.find(child => child.localName === "Period")!.children;
          assert.deepEqual(adaptations.map(node => node.attributes.find(a => a.localName === "id")!.value), ["2", "3"]);
          for (const adaptation of adaptations) {
            const representation = adaptation.children[0]!;
            const list = representation.children.find(child => child.localName === "SegmentList");
            const template = representation.children.find(child => child.localName === "SegmentTemplate");
            const timeline = (list ?? template)!.children.find(child => child.localName === "SegmentTimeline")!;
            const count = timeline.children.reduce((count, entry) => count + Number(entry.attributes.find(a => a.localName === "r")?.value ?? 0) + 1, 0);
            assert.ok(windowSize === 0 || count <= windowSize);
            if (!singleFile) {
              const id = representation.attributes.find(a => a.localName === "id")!.value;
              assert.ok(written.has(`init&${id}.mp4`));
              for (const entry of timeline.children) {
                const time = Number(entry.attributes.find(a => a.localName === "t")!.value);
                const duration = Number(entry.attributes.find(a => a.localName === "d")!.value);
                const repeat = Number(entry.attributes.find(a => a.localName === "r")?.value ?? 0);
                for (let i = 0; i <= repeat; i++) assert.ok(written.has(`part&${id}-${time + duration * i}.m4s`));
              }
              for (const segment of list?.children.filter(child => child.localName === "SegmentURL") ?? []) {
                assert.ok(written.has(segment.attributes.find(a => a.localName === "media")!.value));
              }
            }
            if (singleFile) {
              const uri = representation.children.find(child => child.localName === "BaseURL")!.text;
              const bytes = written.get(uri)!;
              assert.ok(bytes, uri);
              for (const segment of list!.children.filter(child => child.localName === "SegmentURL")) {
                const range = segment.attributes.find(a => a.localName === "mediaRange")!.value.split("-").map(Number);
                assert.ok(range[0]! <= range[1]! && range[1]! < bytes.length);
              }
            }
          }
          if (finalized) assert.deepEqual(publication.manifest, output.manifest);
          publications++;
        }
        assert.ok(publications >= 4);
        assert.equal(finalized, true);
        assert.deepEqual(written, output.resources);
      });
    }
  }
}

it("retains fixed-duration templates in live and finalized manifests", () => {
  const output = serializeDashDocument(source, { segmentDuration: 1, useTimeline: false });
  const publications = [...output.publications()];
  assert.ok(publications.length >= 4);
  for (const { manifest } of publications) {
    const text = new TextDecoder().decode(manifest);
    assert.ok(text.includes('timescale="1000000" duration="1000000"'));
    assert.ok(!text.includes("SegmentTimeline"));
  }
});

it("checks the live manifest against the output byte limit", () => {
  const output = serializeDashDocument(source, { segmentDuration: 1 });
  const total = output.manifest.length + [...output.resources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  const limited = serializeDashDocument(source, { segmentDuration: 1, limits: { maxOutputBytes: total } });
  assert.throws(() => [...limited.publications()], MediaLimitExceededError);
});
