import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const payload = Buffer.alloc(4707 * 2);
for (let i = 0; i < 4707; i++) payload.writeInt16LE(i - 2000, i * 2);
const input = Buffer.alloc(44 + payload.length);
input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
input.writeUInt16LE(2, 32); input.writeUInt16LE(16, 34);
input.write("data", 36); input.writeUInt32LE(payload.length, 40); payload.copy(input, 44);

// Native FFmpeg 7.0.2 produces identical PCM and 256-sample frame boundaries.
for (const graph of [false, true]) {
  for (const options of ["n=2*128:p=0", "n=2^8:p=0", "n=255.5:p=0", "n=256.5:p=0", "256:0", "nb_out_samples=2^8:pad=0", "2*128:0"]) {
    it(`asetnsamples=${options} evaluates frame size (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input, "/out.raw": "KEEP" });
      const filter = `asetnsamples=${options},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-i", "/in.wav",
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
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 9414);
      assert.equal(createHash("sha256").update(output).digest("hex"), "3b1a86d3d5b3270120685f795fd3ea9b42d3298f90a6c90f8882988f3c57ef67");
      assert.deepEqual(output, payload);
      const lines = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
      assert.equal(lines.length, 19);
      for (const [n, line] of lines.entries()) {
        assert.ok(line.includes(`n:${n} pts:${n * 256} `), line);
        assert.ok(line.includes(`nb_samples:${n === 18 ? 99 : 256} `), line);
      }
    });
  }
}
