import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(44 + 29 * 2);
input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
input.writeUInt16LE(2, 32); input.writeUInt16LE(16, 34);
input.write("data", 36); input.writeUInt32LE(58, 40);
for (let i = 0; i < 29; i++) input.writeInt16LE(i + 1, 44 + i * 2);

for (const graph of [false, true]) {
  for (const [options, size, status = 0] of [
    ["n=1024", 1024], ["n=default", 1024], ["nb_out_samples=default", 1024],
    ["default", 1024], ["n=1", 1], ["n=min", 1], ["nb_out_samples=min", 1], ["min", 1],
    ["n=default/32", 32], ["n=min+31", 32], ["n=32:n=default", 1024],
    ["n=32:threads=0", 32], ["n=32:threads=default", 32], ["n=32:threads=min", 32],
    ["n=32:extra_hw_frames=-1", 32], ["n=32:extra_hw_frames=min", 32],
    ["n=32:extra_hw_frames=default", 32],
    ["n=32:threads=default+1:extra_hw_frames=min+1", 32],
    ["n=min-1", 0, 222], ["n=32:threads=min-1", 0, 222],
    ["n=32:extra_hw_frames=default-1", 0, 222],
    ["n=bogus", 0, 234], ["n=32:threads=slice", 0, 234],
    ["n=32:extra_hw_frames=slice", 0, 234]
  ] as const) {
    it(`asetnsamples=${options} resolves option constants (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input, "/out.crc": "KEEP" });
      const filter = `asetnsamples=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "framecrc", "/out.crc"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      assert.deepEqual(volume.readFileSync("/in.wav"), input);
      const output = volume.readFileSync("/out.crc", "utf8") as string;
      if (status !== 0) {
        assert.equal(output, "KEEP");
        return;
      }
      const frames = output.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()));
      // Native FFmpeg 7.0.2, mono 8 kHz PCM containing the samples 1 through 29.
      const checksums = size === 1024 ? ["0x595301b3"] : size === 32 ? ["0x2d5001b3"]
        : Array.from({ length: 29 }, (_, i) => `0x${((i + 1) * 0x20001).toString(16).padStart(8, "0")}`);
      assert.deepEqual(frames, checksums.map((checksum, i) =>
        ["0", String(i * size), String(i * size), String(size), String(size * 2), checksum]));
    });
  }
}
