import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const payload = Buffer.alloc(4707 * 4);
for (let i = 0; i < 4707; i++) payload.writeInt32LE(1073741824 + i, i * 4);
const input = Buffer.alloc(44 + payload.length);
input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
input.writeUInt32LE(8000, 24); input.writeUInt32LE(32000, 28);
input.writeUInt16LE(4, 32); input.writeUInt16LE(32, 34);
input.write("data", 36); input.writeUInt32LE(payload.length, 40); payload.copy(input, 44);

// Native FFmpeg 7.0.2 results, including the unpadded and exactly divisible controls.
for (const graph of [false, true]) {
  for (const [options, samples, hash] of [
    ["512:1", 5120, "7e169376f9392c097168b7074215ee1d93e4ae5e10fdf47a02a6fdc51a48f3d0"],
    ["512:0", 4707, "3b717cc70175d6f5daef4e843255a7a9c0d372e9592cb7213f01e0eb49852856"],
    ["4707:1", 4707, "3b717cc70175d6f5daef4e843255a7a9c0d372e9592cb7213f01e0eb49852856"]
  ] as const) {
    it(`asetnsamples=${options} preserves PCM32 bits (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input, "/out.raw": "KEEP" });
      const filter = `asetnsamples=${options},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s32le", "/out.raw"],
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
      assert.equal(output.length, samples * 4);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      assert.deepEqual(output.subarray(0, payload.length), payload);
      assert.deepEqual(output.subarray(payload.length), Buffer.alloc((samples - 4707) * 4));
    });
  }
}
