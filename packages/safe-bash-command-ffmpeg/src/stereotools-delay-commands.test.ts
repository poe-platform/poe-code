import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 32 }, (_, i) => i % 2 === 0 ? 1000 + i * 231 : -300 - i * 111);
const delayed = [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 2848, -411, 3310, -633, 3772, -855, 4234, -1077, 4696, -1299, 5158, -1521, 5620, -1743, 6082, -1965, 6544, -2187, 7006, -2409, 7468, -2631, 7930, -2853];

// Exact interleaved PCM16 captured from native FFmpeg 7.0.2 at 8000 Hz.
const cases: [string, string, readonly number[]][] = [
  ["0.0005 stereotools delay 1", "stereotools", delayed],
  ["0.0005 stereotools delay -1", "stereotools", [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 1000, -1299, 1462, -1521, 1924, -1743, 2386, -1965, 2848, -2187, 3310, -2409, 3772, -2631, 4234, -2853, 4696, -3075, 5158, -3297, 5620, -3519, 6082, -3741]],
  ["", "stereotools=delay=1", [1000, 0, 1462, 0, 1924, 0, 2386, 0, ...delayed.slice(8)]],
  ["0.00051 stereotools delay 1", "stereotools", [...samples.slice(0, 16), ...delayed.slice(16)]],
  ["0.0005 stereotools delay 1;0.001 stereotools delay 0;0.0015 stereotools delay 1", "stereotools", [...delayed.slice(0, 16), ...samples.slice(16, 24), ...delayed.slice(24)]],
  ["0.0005 stereotools delay -1;0.001 stereotools delay 2", "stereotools=delay=1", [1000, 0, 1462, 0, 1924, 0, 2386, 0, 1000, -1299, 1462, -1521, 1924, -1743, 2386, -1965, 4696, -411, 5158, -633, 5620, -855, 6082, -1077, 6544, -1299, 7006, -1521, 7468, -1743, 7930, -1965]],
  ["0.0005 stereotools@x delay 1/2", "stereotools@x", [1000, -411, 1462, -633, 1924, -855, 2386, -1077, 2848, -855, 3310, -1077, 3772, -1299, 4234, -1521, 4696, -1743, 5158, -1965, 5620, -2187, 6082, -2409, 6544, -2631, 7006, -2853, 7468, -3075, 7930, -3297]],
  ["0.0005 stereotools delay 1;0.001 stereotools delay 21;0.0015 stereotools delay NaN", "stereotools", delayed],
  ["0.0005 stereotools delay 1", "stereotools=mode=lr>rl:phasel=1:enable=gte(n\\,2)", [...samples.slice(0, 16), 2187, 2848, 2409, 3310, 2631, 3772, 2853, 4234, 3075, 4696, 3297, 5158, 3519, 5620, 3741, 6082]],
  ["0.0005 stereotools delay 20", "stereotools", [...samples.slice(0, 8), 2848, 0, 3310, 0, 3772, 0, 4234, 0, 4696, 0, 5158, 0, 5620, 0, 6082, 0, 6544, 0, 7006, 0, 7468, 0, 7930, 0]]
];

for (const [command, filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`matches native timed stereo delay (${graph ? "graph" : "simple"}): ${command} -> ${filter}`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chain = `asetnsamples=n=4:p=0,${command ? `asendcmd=c='${command}',` : ""}${filter}`;
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}
