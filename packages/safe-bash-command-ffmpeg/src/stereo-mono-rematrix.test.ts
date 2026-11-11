import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const pairs = [
  [12001, 0], [0, -24003], [10000, -10000], [30000, 30000], [-30000, -30000], [5, 6],
  [2, 0], [-2, 0], [4, 0], [-4, 0]
];

// Complete native FFmpeg 7.0.2 output, including signed PCM16 rounding ties.
const reference = {
  quarter: {
    s16le: [1500, -3000, 0, 7500, -7500, 1, 0, 0, 1, 0],
    s32le: [98312192, -196632576, 0, 491520000, -491520000, 90112, 16384, -16384, 32768, -32768]
  },
  half: {
    s16le: [3000, -6001, 0, 15000, -15000, 3, 1, 0, 1, -1],
    s32le: [196624384, -393265152, 0, 983040000, -983040000, 180224, 32768, -32768, 65536, -65536]
  },
  unity: {
    s16le: [6001, -12001, 0, 30000, -30000, 6, 1, -1, 2, -2],
    s32le: [393248768, -786530304, 0, 1966080000, -1966080000, 360448, 65536, -65536, 131072, -131072]
  },
  unnormalized: {
    s16le: [8486, -16973, 0, 32767, -32768, 8, 1, -1, 3, -3],
    s32le: [556137728, -1112321792, 0, 2147483647, -2147483648, 509750, 92682, -92682, 185364, -185364]
  }
};

for (const [options, expected] of [
  [[], reference.unity],
  [["rematrix_maxval", "0"], reference.unity],
  [["rematrix_maxval", "0.25"], reference.quarter],
  [["rematrix_maxval", "0.5"], reference.half],
  [["rematrix_maxval", "1"], reference.unity],
  [["rematrix_maxval", "2"], reference.unnormalized],
  [["rematrix_volume", "0.5"], reference.half],
  [["rematrix_maxval", "0.5", "rematrix_volume", "0.5"], reference.quarter]
] as const) for (const form of ["option", "aresample"]) for (const format of ["s16le", "s32le"] as const) {
  it(`matches stereo-to-mono ${format} with ${form} ${options.join(" ") || "defaults"}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [0, 1].map(channel => Float64Array.from(pairs, pair => pair[channel]! / 32768))
    }, { bitsPerSample: 16 }));
    const args = form === "option" ? options.map((value, i) => i % 2 === 0 ? `-${value}` : value)
      : ["-af", `aresample=${options.flatMap((value, i) => i % 2 === 0 ? [`${value}=${options[i + 1]}`] : []).join(":")}`];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-ac", "1", ...args, "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(chunks);
    const width = format === "s32le" ? 4 : 2;
    assert.equal(pcm.length, pairs.length * width);
    assert.deepEqual(Array.from({ length: pairs.length }, (_, i) => pcm.readIntLE(i * width, width)), expected[format]);
  });
}
