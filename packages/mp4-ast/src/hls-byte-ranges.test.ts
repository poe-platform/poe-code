import assert from "node:assert/strict";
import { it } from "node:test";
import { concatBytes, createSyntheticMp4, hlsAst, parseMp4, parseStreamingManifest, serializeDashDocument } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));

for (const bundledInit of [false, true]) {
  it(`reads HLS ranges with ${bundledInit ? "bundled" : "separate"} initialization and implicit media offsets`, () => {
    const { resources } = serializeDashDocument(source, { hlsPlaylist: true, segmentDuration: 1 });
    for (const [index, track] of source.tracks.entries()) {
      const lines = new TextDecoder().decode(resources.get(`media_${index}.m3u8`)).split("\n");
      const init = resources.get(`init-stream${index}.m4s`)!;
      const chunks = [new Uint8Array(7), ...(bundledInit ? [init] : [])];
      let offset = chunks.reduce((sum, bytes) => sum + bytes.length, 0);
      let first = true;
      const playlist = lines.map(line => {
        if (line.startsWith("#EXT-X-MAP:") && bundledInit) return `#EXT-X-MAP:URI="bundle.mp4",BYTERANGE="${init.length}@7"`;
        if (!line || line.startsWith("#")) return line;
        const bytes = resources.get(line)!;
        chunks.push(bytes);
        const result = `#EXT-X-BYTERANGE:${bytes.length}${first ? `@${offset}` : ""}\nbundle.mp4`;
        first = false;
        offset += bytes.length;
        return result;
      }).join("\n");
      const bundle = concatBytes(chunks);
      const output = hlsAst().parse(encode(playlist), { resolveResource: uri => uri === "bundle.mp4" ? bundle : resources.get(uri)! });
      assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
    }
  });
}

it("resolves explicit and implicit media offsets", () => {
  const manifest = parseStreamingManifest(encode("#EXTM3U\n#EXT-X-BYTERANGE:3@7\na.ts\n#EXT-X-BYTERANGE:4\na.ts\n#EXT-X-BYTERANGE:2@1\nb.ts"), "hls");
  assert.deepEqual(manifest.sequences[0]!.map(segment => segment.byteRange), [
    { offset: 7, length: 3 }, { offset: 10, length: 4 }, { offset: 1, length: 2 }
  ]);
});

for (const body of [
  "#EXT-X-BYTERANGE:3\na.ts",
  "#EXT-X-BYTERANGE:3@0\na.ts\n#EXT-X-BYTERANGE:3\nb.ts",
  "a.ts\n#EXT-X-BYTERANGE:3\na.ts",
  ...["0@0", "-1@0", "1@-1", "1.5@0", "1@0@1", "1e2@0", "1@", "9007199254740991@1"].map(range => `#EXT-X-BYTERANGE:${range}\na.ts`),
  '#EXT-X-MAP:URI="init.mp4",BYTERANGE="0@0"\na.ts'
]) {
  it(`rejects invalid HLS byte ranges: ${body}`, () => {
    assert.throws(() => parseStreamingManifest(encode(`#EXTM3U\n${body}`), "hls"), /byte range/i);
  });
}

for (const initialization of [false, true]) {
  it(`rejects truncated ${initialization ? "initialization" : "media"} ranges`, () => {
    const body = initialization ? '#EXT-X-MAP:URI="a.mp4",BYTERANGE="5@0"\na.mp4' : '#EXT-X-BYTERANGE:5@0\na.mp4';
    assert.throws(() => hlsAst().parse(encode(`#EXTM3U\n${body}`), { resolveResource: () => new Uint8Array(4) }), /byte range/i);
  });
}
