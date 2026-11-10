import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 hashes for all 6400 stereo frames, including rounding boundaries.
for (const [filter, format, hash] of [
  ["agate=mode=downward:detection=peak:attack=0.01:release=0.01", "s16le", "b20fcd7bcb5e0b3bc306e385293e85dc59c03d06deb4af8450091498a50c26f5"],
  ["agate=attack=0.01:release=0.01", "f32le", "2884425882df28d121b6a2f4f5cf33a997d2faf5c4bf587880641b482b9b39b4"],
  ["agate=ratio=2:attack=0.01:release=0.01", "s32le", "f1c5ff96853fa83b546384550bcb40ae1434c8f49478d8f0e0ce2d0f1f6e501c"],
  ["agate=detection=peak", "s16le", "9acb1e798fde0234b43fe1994e6768228fd2b76eeccbcfaf291c1d7145a238a6"],
  ["agate", "f32le", "bdd4fe6a35df12a35fce2c8c8dde45ade34160a8474b899feebbc3ea9d4f845e"],
  ["agate=knee=1", "f32le", "5298f60321120cb75094536ad56b1be53f893d0e1d2ba497a8391bc59a6c4be1"]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native ${format} rounding (${graph ? "graph" : "simple"})`, async () => {
    const fs = createMemoryFileSystem();
    const channels = [
      Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
      Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
    ];
    await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels }, { bitsPerSample: 16 }));
    await fs.writeFile("/out.raw", Buffer.from("KEEP"));
    let stderr = "";
    const argumentValues = createCommandArguments(["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "/out.raw"]);
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    const output = await fs.readFile("/out.raw");
    assert.equal(output.length, 6400 * 2 * (format === "s16le" ? 2 : 4));
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
