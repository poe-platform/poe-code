import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete interleaved PCM16 output from native FFmpeg 7.0.2.
const cases = [
  ["2.1|c0=c0|c1=c1|c2=c0", 0, [557, -2357, 209, -1847, 186, -1662, 240, -1554]],
  ["3.0|c0=c0|c1=c1|c2=c0", 0, [1194, -1721, 898, -1158, 928, -920, 1035, -760]],
  ["FL+FR+BC|c0=c0|c1=c1|c2=c0", 0, [1007, -1907, 696, -1360, 711, -1138, 803, -992]],
  ["quad|c0=c0|c1=c1|c2=c0|c3=c1", 0, [951, -4024, 357, -3153, 318, -2838, 411, -2654]],
  ["4.0|c0=c0|c1=c1|c2=c0|c3=c1", 0, [-156, -3071, -408, -2464, -334, -2183, -184, -1979]],
  ["5.0|c0=c0|c1=c1|c2=c0|c3=c1|c4=c0", 0, [-473, -1327, -408, -1010, -247, -789, -64, -590]],
  ["5.1|c0=c0|c1=c1|c2=c0|c3=c1|c4=c0|c5=c1", 0, [1587, -3387, 1046, -2464, 1060, -2096, 1205, -1859]],
  ["7.1|c0=c0|c1=c1|c2=c0|c3=c1|c4=c0|c5=c1|c6=c0|c7=c1", 0, [1981, -5054, 1194, -3770, 1192, -3271, 1375, -2958]],
  ["2.1|c0=c0|c1=c1|c2=c0", 8, [-24, -1776, -247, -1391, -169, -1307, 206, -1520]],
  ["FL+FR|c0=c0|c1=c1", 0, [557, -2357, 209, -1847, 186, -1662, 240, -1554]],
  ["FL+FR|c0=c0|c1=c1", 8, [-24, -1776, -247, -1391, -169, -1307, 206, -1520]],
  ["FC+LFE|c0=c0|c1=c1", 0, [-636, -636, -579, -579, -522, -522, -465, -465]]
] as const;

for (const complex of [false, true]) {
  for (const [pan, blockSize, expected] of cases) {
    it(`negotiates pan=${pan} for crossfeed block_size=${blockSize} (${complex ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 8000,
        channels: [
          Float64Array.from({ length: 4 }, (_, index) => (1000 + index * 83) / 32768),
          Float64Array.from({ length: 4 }, (_, index) => (-3000 + index * 97) / 32768)
        ]
      }));
      const filter = `pan=${pan},crossfeed${blockSize ? `=block_size=${blockSize}` : ""}`;
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "pipe:1"],
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
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
    });
  }
}
