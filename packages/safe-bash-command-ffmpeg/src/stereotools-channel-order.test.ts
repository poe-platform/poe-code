import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 exit codes and interleaved s16le stdout at 8000 Hz.
for (const [filter, exitCode, hex] of [
  ["channelmap=0|1:FR+FL,stereotools", 234, ""],
  ["channelmap=0|1:FR+FR,stereotools", 234, ""],
  ["channelmap=0|1:FR+FL", 0, "6400e803c80030f8d4feb80b70fe60f0"],
  ["channelmap=0|1:FL+FR,stereotools", 0, "6400e803c80030f8d4feb80b70fe60f0"],
  ["channelmap=0|1:FR+FL,channelmap=FL|FR:stereo,stereotools", 0, "e803640030f8c800b80bd4fe60f070fe"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches native channel order (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const pcm = Buffer.from("6400e803c80030f8d4feb80b70fe60f0", "hex");
      const wav = Buffer.alloc(44 + pcm.length);
      wav.write("RIFF");
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(2, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(32000, 28);
      wav.writeUInt16LE(4, 32);
      wav.writeUInt16LE(16, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(pcm.length, 40);
      pcm.copy(wav, 44);
      const volume = Volume.fromJSON({ "/pair.wav": wav });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/pair.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), hex);
    });
  }
}
