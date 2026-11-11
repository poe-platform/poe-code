import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [10000, 0, 0, -6000, 8000, 8000, 8000, -8000, 30000, -29000, -12000, 1200, ...Array<number>(20).fill(0)];
// Captured with native FFmpeg 7.0.2, stereo PCM16 at 8000 Hz.
const cases: [string, readonly number[] | undefined][] = [
  // Exact 90-degree rotation of the native base=-1 stereo averages.
  ["phase=90:base=-1", [-5000, 5000, 3000, -3000, -8000, 8000, 0, 0, -500, 500, 5400, -5400, ...Array<number>(20).fill(0)]],
  ["phase=0", [10000, 0, 0, -6000, 8000, 8000, 8000, -8000, 30000, -29000, -12000, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=45", [7071, 7071, 4243, -4243, 0, 11314, 11314, 0, 32767, 707, -9334, -7637, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90", [0, 10000, 6000, 0, -8000, 8000, 8000, 8000, 29000, 30000, -1200, -12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=180", [-10000, 0, 0, 6000, -8000, -8000, -8000, 8000, -30000, 29000, 12000, -1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=270", [0, -10000, -6000, 0, 8000, -8000, -8000, -8000, -29000, -30000, 1200, 12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=360", [10000, 0, 0, -6000, 8000, 8000, 8000, -8000, 30000, -29000, -12000, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=22.5", [9239, 3827, 2296, -5543, 4330, 10453, 10453, -4330, 32767, -15312, -11546, -3484, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90/2", [7071, 7071, 4243, -4243, 0, 11314, 11314, 0, 32767, 707, -9334, -7637, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phasel=1", [-10000, 0, 0, -6000, -8000, 8000, -8000, -8000, -30000, -29000, 12000, 1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["mode=lr>rl", [0, 10000, -6000, 0, 8000, 8000, -8000, 8000, -29000, 30000, 1200, -12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90:phasel=1", [0, -10000, 6000, 0, -8000, -8000, 8000, -8000, 29000, -30000, -1200, 12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90:phaser=1", [0, 10000, -6000, 0, 8000, 8000, -8000, 8000, -29000, 30000, 1200, -12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90:mutel=1", [0, 0, 6000, 0, -8000, 0, 8000, 0, 29000, 0, -1200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90:muter=1", [0, 10000, 0, 0, 0, 8000, 0, 8000, 0, 30000, 0, -12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=45:mode=lr>ms", [0, 7071, -4243, 0, 5657, 5657, -5657, 5657, -20506, 21213, 849, -8485, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=45:level_in=2:level_out=0.5", [7071, 7071, 4243, -4243, 0, 11314, 11314, 0, 32767, 707, -9334, -7637, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90:balance_in=0.5:balance_out=-0.5", [0, 2500, 6000, 0, -8000, 2000, 8000, 2000, 29000, 7500, -1200, -3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=45:delay=1", [7071, 7071, 0, 0, 5657, 5657, 5657, 5657, 21213, 21213, -4243, -12728, -5657, 5657, 5657, -5657, 20506, -20506, -849, 849, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90:delay=-1", [0, 0, 6000, 0, -8000, 0, 8000, 0, 29000, 10000, -1200, 0, 0, 8000, 0, 8000, 0, 30000, 0, -12000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=45:delay=1:balance_out=0.5:level_out=0.5", [1768, 3536, 0, 0, 1414, 2828, 1414, 2828, 5303, 10607, -1061, -6364, -1414, 2828, 1414, -2828, 5127, -10253, -212, 424, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["phase=90:slev=0.5:mpan=-0.5", [0, 7500, 3000, -1500, -4000, 8000, 4000, 4000, 14500, 15250, -600, -8700, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
];
for (const value of ["-1", "360.1", "NaN", "Infinity", "bad", ""]) {
  cases.push([`phase=${value}`, undefined]);
}
for (const [options, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native stereo phase (${graph ? "graph" : "simple"}): ${options}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/impulses.wav", encodeWav({ sampleRate: 8000,
        channels: [0, 1].map(channel => Float64Array.from(
          samples.filter((_, index) => index % 2 === channel), sample => sample / 32768)) }));
      let stderr = "";
      const filter = `stereotools=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/impulses.wav",
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
