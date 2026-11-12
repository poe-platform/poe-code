import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 s16le output for four stereo frames at 8 kHz.
for (const graph of [false, true]) {
  for (const [options, expected] of [
    ["seed=7:stages=2:1", [6416, -5522, 6453, -5999, 5157, -5026, 2925, -3091]],
    ["stages=1:stages=2:7:seed=7", [6, -4, 29, -18, 79, -52, 159, -110]],
    ["1:7", [6416, -5522, 6453, -5999, 5157, -5026, 2925, -3091]],
    ["7:7", [6, -4, 29, -18, 79, -52, 159, -110]],
    ["seed=7:stages=2", [2214, -1540, 3526, -2729, 3898, -3212, 3379, -2992]]
  ] as const) {
    it(`adecorrelate=${options} binds options like native FFmpeg (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 8000,
        channels: [
          Float64Array.from([16000, 8000, 4000, 0], sample => sample / 32768),
          Float64Array.from([-16000, -8000, -4000, 0], sample => sample / 32768)
        ]
      }, { bitsPerSample: 16 }));
      const filter = `adecorrelate=${options}`;
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
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
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: expected.length }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}
