import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95];
// Captured from native FFmpeg with stereo s16le input/output at 8000 Hz.
const cases: [string, readonly number[]][] = [
  ["asetnsamples=n=2:p=0,stereotools=delay=0.25", [1000, 0, 3000, -2000, -527, 1234, 32767, 909, 17, -32000, 94, -33]],
  ["asetnsamples=n=2:p=0,stereotools=delay=0.25:enable=gte(n\\,1)", [1000, -2000, 3000, 1234, -527, 1234, 32767, 909, 17, -32000, 94, -33]],
  ["asetnsamples=n=2:p=0,stereotools=delay=0.25:enable=not(mod(n\\,2))", [1000, 0, 3000, -2000, -527, 909, 32767, -32000, 17, -32000, 94, -33]],
  ["asetnsamples=n=2:p=0,stereotools=delay=0.25:enable=0", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["asetnsamples=n=2:p=0,stereotools=delay=0.25:level_in=0.5:mode=lr>rl:phasel=1:phaser=1:enable=not(mod(n\\,2))", [1000, 0, -617, -500, -527, 909, 32767, -32000, 16, -16384, -48, -8]],
  ["asetnsamples=n=2:p=0,stereotools=delay=-0.25", [0, -2000, 1000, 1234, 3000, 909, -527, -32000, 32767, -33, 17, 95]],
  ["asetnsamples=n=2:p=0,stereotools=delay=-0.25:enable=gte(n\\,1)", [1000, -2000, 3000, 1234, 3000, 909, -527, -32000, 32767, -33, 17, 95]],
  ["asetnsamples=n=2:p=0,stereotools=delay=-0.25:enable=not(mod(n\\,2))", [0, -2000, 1000, 1234, -527, 909, 32767, -32000, 32767, -33, 17, 95]],
  ["asetnsamples=n=2:p=0,stereotools=delay=-0.25:enable=0", [1000, -2000, 3000, 1234, -527, 909, 32767, -32000, 17, -33, 94, 95]],
  ["asetnsamples=n=2:p=0,stereotools=delay=-0.25:level_in=0.5:mode=lr>rl:phasel=1:phaser=1:enable=not(mod(n\\,2))", [0, -500, 1000, -1500, -527, 909, 32767, -32000, 16000, -8, 16, -47]]
];
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`preserves native stereo delay history (${graph ? "graph" : "simple"}): ${filter}`, async () => {
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
