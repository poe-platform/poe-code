import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, hlsAst, parseStreamingManifest } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const master = encode('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=80000,CODECS="mp4a.40.2"\nsub/audio.m3u8\n');
const media = encode('#EXTM3U\n#EXTINF:1,\n../part.mp4\n');

it("resolves a master playlist and resolves segments relative to its media playlist", () => {
  const segment = createSyntheticMp4({ frameCount: 25, fps: 25 });
  const reads: string[] = [];
  const doc = hlsAst().parse(master, { resolveResource(uri) {
    reads.push(uri);
    return uri === "sub/audio.m3u8" ? media : segment;
  } });
  assert.deepEqual(reads, ["sub/audio.m3u8", "sub/../part.mp4"]);
  assert.equal(doc.tracks[0]!.samples.length, 25);
});

it("rejects nested master playlists without recursive reads", () => {
  assert.throws(() => hlsAst().parse(master, { resolveResource: () => master }), error => error instanceof Error && error.message.includes("Nested HLS master"));
});

it("keeps absolute media resources absolute", () => {
  const manifest = parseStreamingManifest(master, "hls", { resolveResource: () => encode('#EXTM3U\n#EXT-X-MAP:URI="/init.mp4"\n#EXTINF:1,\n/part.m4s\n') });
  assert.equal(manifest.sequences[0]![0]!.uri, "/part.m4s");
  assert.equal(manifest.sequences[0]![0]!.initialization, "/init.mp4");
});

for (const body of ["#EXT-X-STREAM-INF:BANDWIDTH=1\n", "#EXT-X-STREAM-INF:BANDWIDTH=1\na\n#EXT-X-STREAM-INF:BANDWIDTH=2\nb\n"]) {
  it(`rejects incomplete or multiple variants: ${JSON.stringify(body)}`, () => {
    assert.throws(() => parseStreamingManifest(encode("#EXTM3U\n" + body), "hls"));
  });
}
