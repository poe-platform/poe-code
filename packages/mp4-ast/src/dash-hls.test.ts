import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeDashDocument, hlsAst, concatBytes, MediaLimitExceededError } from "./index.js";

const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
const source = { ...base, tracks: base.tracks.map(track => ({
  ...track, language: track.type === "audio" ? "fra" : "und",
  samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
})) };

for (const singleFile of [false, true]) {
  for (const windowSize of [0, 2]) {
    it(`DASH HLS references shared fragments with singleFile ${singleFile} and window ${windowSize}`, () => {
      const options = { hlsPlaylist: true, singleFile, windowSize, segmentDuration: 1,
        initSegmentName: "init-$RepresentationID$.mp4", mediaSegmentName: "part-$RepresentationID$-$Number$.m4s" };
      const { manifest, resources } = serializeDashDocument(source, options);
      const master = new TextDecoder().decode(resources.get("master.m3u8"));
      assert.ok(master.includes('LANGUAGE="fra"'), master);
      assert.ok(master.includes('AUDIO="group_A1"'), master);
      for (const [index, track] of source.tracks.entries()) {
        const bytes = resources.get(`media_${index}.m3u8`)!;
        assert.ok(bytes);
        const playlist = new TextDecoder().decode(bytes);
        assert.ok(playlist.endsWith("#EXT-X-ENDLIST\n"));
        assert.equal(playlist.includes("#EXT-X-BYTERANGE:"), singleFile);
        const ranges = playlist.split("\n").filter(line => line.startsWith("#EXT-X-BYTERANGE:")).map(line => {
          const [length, offset] = line.slice("#EXT-X-BYTERANGE:".length).split("@").map(Number);
          const resource = resources.get(`stream${index}.mp4`)!;
          assert.ok(offset! + length! <= resource.length);
          return resource.slice(offset!, offset! + length!);
        });
        const initLength = Number(playlist.split('BYTERANGE="')[1]?.split("@")[0]);
        const output = singleFile ? parseMp4(concatBytes([
          resources.get(`stream${index}.mp4`)!.slice(0, initLength), ...ranges
        ])) : hlsAst().parse(bytes, { resolveResource: uri => {
          assert.ok(resources.has(uri), uri);
          return resources.get(uri)!;
        } });
        const samples = output.tracks[0]!.samples;
        assert.ok(samples.length > 0);
        assert.deepEqual(samples.map(sample => sample.data),
          track.samples.slice(windowSize ? -samples.length : 0).map(sample => sample.data));
      }
      const total = manifest.length + [...resources.values()].reduce((sum, bytes) => sum + bytes.length, 0);
      assert.throws(() => serializeDashDocument(source, { ...options, limits: { maxOutputBytes: total - 1 } }), MediaLimitExceededError);
      assert.equal(serializeDashDocument(source, { ...options, limits: { maxOutputBytes: total } }).manifest.length, manifest.length);
    });
  }
}
it("DASH omits HLS resources by default", () => {
  assert.ok([...serializeDashDocument(source).resources.keys()].every(uri => !uri.endsWith(".m3u8")));
});
