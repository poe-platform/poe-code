import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output, including non-neutral stereo effect defaults.
const cases = [
  {
    pan: "3.0|c0=c0|c1=c1|c2=c0",
    outputs: {
      stereotools: [1707, -2293, 1849, -2137, 1990, -1982, 2132, -1826],
      stereowiden: [2054, -2346, 2120, -2264, 2187, -2182, 2253, -2100],
      extrastereo: [4707, -5293, 4838, -5127, 4969, -4961, 5101, -4794]
    }
  },
  {
    pan: "quad|c0=c0|c1=c1|c2=c0|c3=c1",
    outputs: {
      stereotools: [1707, -5121, 1849, -4956, 1990, -4790, 2132, -4625],
      stereowiden: [2902, -4609, 2966, -4519, 3029, -4429, 3093, -4339],
      extrastereo: [6828, -10243, 6952, -10059, 7076, -9876, 7200, -9692]
    }
  },
  {
    pan: "FL+FR+BC|c0=c0|c1=c1|c2=c0",
    outputs: {
      stereotools: [1500, -2500, 1624, -2362, 1749, -2223, 1874, -2084],
      stereowiden: [1950, -2450, 2008, -2377, 2066, -2303, 2124, -2230],
      extrastereo: [4500, -5500, 4614, -5351, 4728, -5202, 4842, -5053]
    }
  },
  {
    pan: "5.0|c0=c0|c1=c1|c2=c0|c3=c1|c4=c0",
    outputs: {
      stereotools: [-414, -1586, -204, -1371, 6, -1157, 217, -943],
      stereowiden: [144, -1144, 248, -1036, 352, -928, 456, -819],
      extrastereo: [464, -2464, 672, -2247, 879, -2030, 1086, -1812]
    }
  },
  {
    pan: "2.1|c0=c0|c1=c1|c2=c0",
    outputs: { stereotools: [1000, -3000, 1083, -2903, 1166, -2806, 1249, -2709] }
  },
  {
    pan: "5.1|c0=c0|c1=c1|c2=c0|c3=c1|c4=c0|c5=c1",
    outputs: { extrastereo: [7536, -9536, 7718, -9293, 7900, -9051, 8083, -8809] }
  },
  {
    pan: "FL+FR|c0=c0|c1=c1",
    outputs: { stereowiden: [1700, -2700, 1737, -2647, 1775, -2595, 1812, -2542] }
  }
];

for (const { pan, outputs } of cases) for (const [filter, expected] of Object.entries(outputs)) {
  for (const complex of [false, true]) {
    it(`downmixes pan=${pan} before ${filter} (${complex ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 4 }, (_, i) => (1000 + i * 83) / 32768),
        Float64Array.from({ length: 4 }, (_, i) => (-3000 + i * 97) / 32768)
      ] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const output: Buffer[] = [];
      let stderr = "";
      const graph = `pan=${pan},${filter}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${graph}[s]`, "-map", "[s]"] : ["-af", graph]),
        "-f", "s16le", "pipe:1"],
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
      assert.deepEqual(expected.map((_, index) => pcm.readInt16LE(index * 2)), expected);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
