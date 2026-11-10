import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { it } from "node:test";
import { hlsAst, parseStreamingManifest } from "./index.js";
import native from "../../../tests/fixtures/media/hls-missing.json" with { type: "json" };

for (const explicit of [true, false]) {
  it(`decrypts HLS fragments with ${explicit ? "explicit" : "sequence"} IVs and key rotation`, () => {
    const files = new Map(Object.entries(native.files).map(([path, data]) => [path, new Uint8Array(Buffer.from(data, "base64"))]));
    const clear = files.get("audio.m3u8")!;
    const expected = hlsAst().parse(clear, { resolveResource: uri => files.get(uri)! });
    let sequence = 7;
    const lines = new TextDecoder().decode(clear).split("\n");
    const playlist = lines.flatMap(line => {
      if (!line.endsWith(".m4s")) return [line];
      const key = new Uint8Array(16).fill(sequence);
      const iv = new Uint8Array(16); iv[15] = explicit ? 0 : sequence;
      const cipher = createCipheriv("aes-128-cbc", key, iv);
      files.set(line, new Uint8Array(Buffer.concat([cipher.update(files.get(line)!), cipher.final()])));
      files.set(`key${sequence}.key`, key);
      return [`#EXT-X-KEY:METHOD=AES-128,URI="key${sequence++}.key"${explicit ? ",IV=0x00000000000000000000000000000000" : ""}`, line];
    });
    playlist.splice(1, 0, "#EXT-X-MEDIA-SEQUENCE:7");
    const actual = hlsAst().parse(new TextEncoder().encode(playlist.join("\n")), { resolveResource: uri => files.get(uri)! });
    assert.deepEqual(actual.tracks.map(t => t.samples), expected.tracks.map(t => t.samples));
  });
}
it("clears encryption with METHOD=NONE and rejects unsupported encryption", () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const plan = parseStreamingManifest(encode('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-KEY:METHOD=NONE\npart.ts\n'), "hls");
  assert.equal(plan.sequences[0]![0]!.encryption, undefined);
  assert.throws(() => parseStreamingManifest(encode('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\npart.ts\n'), "hls"), /Unsupported HLS encryption/);
});

for (const attributes of ['METHOD=AES-128', 'METHOD=AES-128,URI="key",IV=0xzz', 'METHOD=AES-128,URI="key",KEYFORMAT="other"']) {
  it(`rejects invalid encryption attributes: ${attributes}`, () => {
    assert.throws(() => parseStreamingManifest(new TextEncoder().encode(`#EXTM3U\n#EXT-X-KEY:${attributes}\npart.ts\n`), "hls"), /HLS/);
  });
}
it("resolves nested playlist keys and rejects invalid key lengths and padding", () => {
  const files = new Map(Object.entries(native.files).map(([path, data]) => [`media/${path}`, new Uint8Array(Buffer.from(data, "base64"))]));
  const child = new TextDecoder().decode(files.get("media/audio.m3u8")).replace("#EXTINF:", '#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x00\n#EXTINF:');
  files.set("media/audio.m3u8", new TextEncoder().encode(child));
  const master = new TextEncoder().encode('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmedia/audio.m3u8\n');
  const options = { resolveResource: (uri: string) => files.get(uri)! };
  assert.equal(parseStreamingManifest(master, "hls", options).sequences[0]![0]!.encryption!.uri, "media/key");
  files.set("media/key", new Uint8Array(15));
  assert.throws(() => hlsAst().parse(master, options), /exactly 16 bytes/);
  files.set("media/key", new Uint8Array(16));
  files.set("media/audio0.m4s", new Uint8Array(17));
  assert.throws(() => hlsAst().parse(master, options), /ciphertext|block|length/i);
});
