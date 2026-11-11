import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, one PCM16 frame at 8000 Hz: sample c = 100 * c + 17.
for (const [channels, floating, integer] of [
  [4, [329, 429], [149, 194]],
  [6, [465, 636], [193, 263]]
] as const) {
  for (const [filter, expected] of [
    ["stereotools", floating],
    ["aformat=channel_layouts=stereo,stereotools", floating],
    ["aformat=cl=stereo,stereotools@mix", floating],
    ["aformat=sample_fmts=dbl:channel_layouts=stereo,stereotools", floating],
    ["aformat=sample_fmts=s16:channel_layouts=stereo,stereotools", integer],
    ["aformat=cl=stereo:f=s16,stereotools", integer],
    ["aformat=channel_layouts=stereo", integer]
  ] as const) {
    for (const graph of [false, true]) {
      it(`negotiates ${channels}-channel ${filter} (graph=${graph})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: Array.from({ length: channels }, (_, c) => Float64Array.of((100 * c + 17) / 32768)) }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 4);
        assert.deepEqual([output.readInt16LE(0), output.readInt16LE(2)], expected);
      });
    }
  }
}
