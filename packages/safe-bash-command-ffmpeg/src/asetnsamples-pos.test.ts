import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(44 + 29 * 2);
input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
input.writeUInt16LE(2, 32); input.writeUInt16LE(16, 34);
input.write("data", 36); input.writeUInt32LE(58, 40);
for (let i = 0; i < 29; i++) input.writeInt16LE(i + 1, 44 + i * 2);

// Native FFmpeg 7.0.2: the WAV packet starts at byte 44.
for (const graph of [false, true]) {
  for (const [enable, size, checksum] of [
    ["eq(pos,44)", 64, "0x2d5001b3"],
    ["eq(pos,45)", 58, "0x231e01b3"],
    ["gt(pos,0)", 64, "0x2d5001b3"],
    ["gt(pos,100)", 58, "0x231e01b3"],
    ["pos", 64, "0x2d5001b3"]
  ] as const) {
    it(`asetnsamples enable=${enable} uses packet position (graph ${graph})`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.wav", input);
      const filter = `asetnsamples=n=32:enable='${enable}'`;
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "framecrc", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      assert.equal(result.exitCode, 0, stderr);
      const frames = stdout.split("\n").filter(line => line && !line.startsWith("#"));
      assert.deepEqual(frames.map(line => line.split(",").map(field => field.trim())),
        [["0", "0", "0", String(size / 2), String(size), checksum]]);
    });
  }
}
