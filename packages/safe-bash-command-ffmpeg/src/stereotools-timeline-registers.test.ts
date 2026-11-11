import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 32 }, (_, i) => i % 2 === 0 ? 1000 + i * 231 : -300 - i * 111);
// Captured from native FFmpeg with stereo s16le input/output at 8000 Hz.
const cases: [string, readonly number[]][] = [
  ["asetnsamples=n=4:p=0,stereotools=mutel=1:enable='eq(st(0,ld(0)+1),2)'",
    [0, -411, 0, -633, 0, -855, 0, -1077, 2848, -1299, 3310, -1521, 3772, -1743, 4234, -1965, 4696, -2187, 5158, -2409, 5620, -2631, 6082, -2853, 6544, -3075, 7006, -3297, 7468, -3519, 7930, -3741]],
  ["asetnsamples=n=4:p=0,stereotools=mutel=1:enable='eq(n,1)'",
    [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 0, -1299, 0, -1521, 0, -1743, 0, -1965, 4696, -2187, 5158, -2409, 5620, -2631, 6082, -2853, 6544, -3075, 7006, -3297, 7468, -3519, 7930, -3741]],
  ["asetnsamples=n=4:p=0,stereotools=mutel=1:enable='eq(st(0,ld(0)+1),4)'",
    samples.map((value, index) => index >= 8 && index < 16 && index % 2 === 0 ? 0 : value)],
  ["asetnsamples=n=4:p=0,stereotools@left=mutel=1:enable='eq(st(0,ld(0)+1),2)',stereotools@right=muter=1:enable='eq(st(0,ld(0)+1),2)'",
    samples.map((value, index) => index < 8 ? 0 : value)]
];
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`preserves stereo timeline registers (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({});
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
    });
  }
}
