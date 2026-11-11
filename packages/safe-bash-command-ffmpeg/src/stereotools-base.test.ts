import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [10000, 0, 0, -6000, 8000, 8000, 8000, -8000, 30000, -29000, -12000, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// PCM captured from native FFmpeg 7.0.2, including clipping and processing order.
const cases: [string, readonly number[] | undefined][] = [
  ["stereotools", [10000, 0, 0, -6000, 8000, 8000, 8000, -8000, 30000, -29000, -12000, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=phasel=1", [-10000, 0, 0, -6000, -8000, 8000, -8000, -8000, -30000, -29000, 12000, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=mode=lr>rl", [0, 10000, -6000, 0, 8000, 8000, -8000, 8000, -29000, 30000, 1200, -12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=-1", [5000, 5000, -3000, -3000, 8000, 8000, 0, 0, 500, 500, -5400, -5400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=-0.5", [7500, 2500, -1500, -4500, 8000, 8000, 4000, -4000, 15250, -14250, -8700, -2100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0", [10000, 0, 0, -6000, 8000, 8000, 8000, -8000, 30000, -29000, -12000, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5", [15000, -5000, 3000, -9000, 8000, 8000, 16000, -16000, 32767, -32768, -18600, 7800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=1", [20000, -10000, 6000, -12000, 8000, 8000, 24000, -24000, 32767, -32768, -25200, 14400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=1/2", [15000, -5000, 3000, -9000, 8000, 8000, 16000, -16000, 32767, -32768, -18600, 7800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:phasel=1", [-15000, 5000, 3000, -9000, -16000, 16000, -8000, -8000, -30500, -28500, 17400, -4200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:mutel=1", [0, 0, 3000, -9000, -4000, 12000, 4000, -12000, 14500, -32768, -600, 1800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:mode=lr>ms", [5000, 5000, -6000, 6000, 12000, -4000, -4000, 12000, -14000, 32767, -4800, -7200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:mode=ms>lr", [10000, 10000, -12000, 12000, 24000, -8000, -8000, 24000, -28000, 32767, -9600, -14400, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:level_out=0.5", [7500, -2500, 1500, -4500, 4000, 4000, 8000, -8000, 29750, -29250, -9300, 3900, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:level_in=2:level_out=0.5", [15000, -5000, 3000, -9000, 8000, 8000, 16000, -16000, 32767, -32768, -18600, 7800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:delay=0.5", [15000, -5000, 0, 0, 12000, -4000, 15000, -13000, 32767, -3000, -14000, -6000, 14500, -32768, -600, 1800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=-0.5:delay=-0.5", [0, 0, -1500, -4500, 9500, 8500, -2000, -6000, -1250, -19750, 6300, 2900, 22500, 7500, -9000, -3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5:balance_out=0.5", [7500, -5000, 1500, -9000, 4000, 8000, 8000, -16000, 29750, -32768, -9300, 7800, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["stereotools=base=0.5,stereotools=level_out=0.5", [7500, -2500, 1500, -4500, 4000, 4000, 8000, -8000, 29750, -29250, -9300, 3900, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]
];
for (const value of ["2", "-2", "1.001", "-1.001", "NaN", "Infinity", "bad", ""]) {
  cases.push([`stereotools=base=${value}`, undefined]);
}
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native stereo width PCM (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/impulses.wav", encodeWav({
        sampleRate: 8000,
        channels: [0, 1].map(channel => Float64Array.from(
          samples.filter((_, index) => index % 2 === channel), sample => sample / 32768))
      }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/impulses.wav",
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
      if (!expected) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("stereotools"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
    });
  }
}
