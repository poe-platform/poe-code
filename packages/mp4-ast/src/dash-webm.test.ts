import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { concatBytes, createSyntheticMp4, dashAst, parseMkv, parseMp4, parseStreamingManifest, serializeDashDocument, MediaLimitExceededError } from "./index.js";

// Native FFmpeg: -i dash-vp9.webm -map 0 -c copy -f dash -seg_duration 1 out.mpd.
const source = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/dash-vp9.webm", import.meta.url))));

for (const options of [{}, { useTemplate: false }, { useTimeline: false },
  { initSegmentName: "init&$RepresentationID$.$ext$", mediaSegmentName: "part&$Number$.$ext$" }]) {
  it(`copies VP9 DASH into WebM initialization and clusters: ${JSON.stringify(options)}`, () => {
    const { manifest, resources } = serializeDashDocument(source, { segmentDuration: 1, ...options });
    assert.ok(new TextDecoder().decode(manifest).includes('mimeType="video/webm"'));
    const sequence = parseStreamingManifest(manifest, "dash").sequences[0]!;
    assert.equal(sequence.length, 2);
    assert.ok(sequence[0]!.initialization!.endsWith(".webm"));
    const initialization = resources.get(sequence[0]!.initialization!)!;
    assert.deepEqual([...initialization.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
    for (const segment of sequence) {
      assert.ok(segment.uri.endsWith(".webm"));
      assert.deepEqual([...resources.get(segment.uri)!.subarray(0, 4)], [0x1f, 0x43, 0xb6, 0x75]);
    }
    const joined = parseMkv(concatBytes([initialization, ...sequence.map(segment => resources.get(segment.uri)!)]));
    const parsed = dashAst().parse(manifest, { resolveResource: uri => resources.get(uri)! });
    for (const output of [joined, parsed]) {
      assert.equal(output.tracks[0]!.samples.length, 16);
      assert.deepEqual(output.tracks[0]!.samples.map(s => [s.pts, s.duration, s.data]), source.tracks[0]!.samples.map(s => [s.pts, s.duration, s.data]));
    }
  });
}

it("keeps H.264 in MP4 alongside a VP9 WebM representation", () => {
  const h264 = parseMp4(createSyntheticMp4({ frameCount: 16, fps: 8 }));
  const { manifest, resources } = serializeDashDocument({ ...source, tracks: [...source.tracks, ...h264.tracks] }, { segmentDuration: 1 });
  const text = new TextDecoder().decode(manifest);
  assert.ok(text.includes('mimeType="video/webm"'));
  assert.ok(text.includes('mimeType="video/mp4"'));
  assert.ok(resources.has("init-stream0.webm"));
  assert.equal(new TextDecoder().decode(resources.get("init-stream1.m4s")!.subarray(4, 8)), "ftyp");
});

it("writes a single-file WebM without MP4 segment indexes", () => {
  const { manifest, resources } = serializeDashDocument(source, { segmentDuration: 1, singleFile: true });
  const text = new TextDecoder().decode(manifest);
  assert.ok(text.includes('<BaseURL>stream0.webm</BaseURL>'));
  assert.ok(!text.includes("indexRange"));
  assert.equal(parseMkv(resources.get("stream0.webm")!).tracks[0]!.samples.length, 16);
});

it("bounds aggregate WebM DASH output", () => {
  const { manifest, resources } = serializeDashDocument(source, { segmentDuration: 1 });
  const size = manifest.length + [...resources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  assert.throws(() => serializeDashDocument(source, { segmentDuration: 1, limits: { maxOutputBytes: size - 1 } }), MediaLimitExceededError);
});
