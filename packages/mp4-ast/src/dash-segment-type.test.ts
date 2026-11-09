import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { concatBytes, createSyntheticMp4, parseMkv, parseMp4, parseStreamingManifest, serializeDashDocument } from "./index.js";

const vp9 = parseMkv(readFileSync(new URL("./fixtures/dash-vp9.webm", import.meta.url)));

for (const segmentType of ["mp4", "webm", "auto"] as const) {
  for (const singleFile of [false, true]) {
    it(`copies all VP9 packets into explicit ${segmentType} DASH (single file ${singleFile})`, () => {
      const { manifest, resources } = serializeDashDocument(vp9, { segmentType, singleFile, segmentDuration: 1 });
      const webm = segmentType !== "mp4";
      const text = new TextDecoder().decode(manifest);
      assert.ok(text.includes(`mimeType="video/${webm ? "webm" : "mp4"}"`), text);
      const parts = singleFile ? [...resources.values()] : (() => {
        const sequence = parseStreamingManifest(manifest, "dash").sequences[0]!;
        assert.equal(sequence.length, 2);
        assert.ok(sequence.every(segment => segment.uri.endsWith(webm ? ".webm" : ".m4s")));
        return [resources.get(sequence[0]!.initialization!)!, ...sequence.map(segment => resources.get(segment.uri)!)];
      })();
      const bytes = concatBytes(parts);
      if (webm) assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
      else assert.equal(new TextDecoder().decode(bytes.subarray(4, 8)), "ftyp");
      const output = webm ? parseMkv(bytes) : parseMp4(bytes);
      assert.equal(output.tracks[0]!.samples.length, 16);
      assert.deepEqual(output.tracks[0]!.samples.map(s => [s.pts / output.tracks[0]!.timescale, [...s.data]]),
        vp9.tracks[0]!.samples.map(s => [s.pts / vp9.tracks[0]!.timescale, [...s.data]]));
    });
  }
}

it("uses the selected container for DASH extension tokens", () => {
  const { manifest, resources } = serializeDashDocument(vp9, { segmentType: "mp4", segmentDuration: 1,
    initSegmentName: "i-$RepresentationID$.$ext$", mediaSegmentName: "m-$Number$.$ext$" });
  assert.deepEqual([...resources.keys()], ["i-0.m4s", "m-1.m4s", "m-2.m4s"]);
  assert.ok(new TextDecoder().decode(manifest).includes('initialization="i-$RepresentationID$.m4s"'));
});

it("rejects H.264 in explicitly selected WebM DASH", () => {
  const h264 = parseMp4(createSyntheticMp4({ includeAudio: false }));
  assert.throws(() => serializeDashDocument(h264, { segmentType: "webm" }), /WebM/);
});
