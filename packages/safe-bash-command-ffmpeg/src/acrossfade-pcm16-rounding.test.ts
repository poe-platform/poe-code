import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 outputs from FFmpeg 7.0.2, including the unfaded tail.
for (const [options, halves, integers] of [
  ["c1=nofade:c2=nofade", [100, 200, 300, 400, 498, 598, 700, 800, 2, 2, 4, 4],
    [100, 200, 300, 400, 497, 598, 699, 800, 1, 2, 3, 4]],
  ["c1=tri:c2=tri", [100, 200, 300, 400, 375, 299, 175, 0, 2, 2, 4, 4],
    [100, 200, 300, 400, 375, 299, 174, 0, 1, 2, 3, 4]],
  ["c1=nofade:c2=nofade:o=0", [100, 200, 300, 400, 500, 600, 700, 800, -2, -2, 0, 0, 2, 2, 4, 4],
    [100, 200, 300, 400, 500, 600, 700, 800, -3, -2, -1, 0, 1, 2, 3, 4]],
  ["c1=qsin:c2=qsin", [100, 200, 300, 400, 461, 423, 267, 0, 2, 2, 4, 4],
    [100, 200, 300, 400, 461, 423, 267, 0, 1, 2, 3, 4]]
] as const) {
  for (const halfSample of [true, false]) {
    it(`acrossfade converts float32 to PCM16 before fading (${options}, halfSample=${halfSample})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([100, 200, 300, 400, 500, 600, 700, 800], value => value / 32768)] }));
      volume.writeFileSync("/b.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from([-3, -2, -1, 0, 1, 2, 3, 4], value =>
          (value + (halfSample ? 0.5 : 0)) / 32768)] }, { bitsPerSample: 32, float: true }));
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
          `[0:a][1:a]acrossfade=ns=4:${options}[o]`, "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
        halfSample ? halves : integers);
    });
  }
}
