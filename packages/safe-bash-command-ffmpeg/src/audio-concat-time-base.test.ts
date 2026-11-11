import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)] });

// Native FFmpeg 7.0.2: concat exposes microseconds, while atrim counts sample PTS.
for (const separated of [false, true]) {
  for (const [filter, expected] of [
    ["asetpts=PTS+125,atrim=end_pts=10", samples.slice(0, 9)],
    ["asettb=1/1000000,asetpts=PTS+125,atrim=end_pts=10", samples.slice(0, 9)],
    ["atrim=end_pts=10", samples.slice(0, 10)],
    ["asettb=1/8000,asetpts=PTS+1,atrim=end_pts=10", samples.slice(0, 9)],
    ["aselect='eq(TB,1/1000000)*eq(pts,1500)'", samples]
  ] as const) {
    it(`concat downstream time base: ${filter} (separate node=${separated})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
          `[0:a][0:a]concat=v=0:a=1${separated ? "[joined];[joined]" : ","}${filter}[out]`,
          "-map", "[out]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const pcm = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}
