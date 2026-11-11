import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 64 mono samples at 1000 Hz, repeating 17-sample ramp.
for (const [format, filter, bytes, sample11, hash] of [
  ["s32le", "atempo=1", 4, 196804416, "e7420ecfb76934ebfec772d8e47521fdc2b95ca5fa70bd92edcb0cccc8ac5fc7"],
  ["f32le", "atempo=1", 4, 0.09164419770240784, "49f3cc12f432aa50c432fa8a90fc9f18df0459dc6db0799fd424df7ed4ebe5d8"],
  ["f64le", "atempo=1", 8, 0.09164419770240784, "231786e32d21ee962de9c5e246df0b0e6fa08a73bf47e97dacb85feadde86c83"],
  ["s16le", "atempo=1", 2, 3002, "2b9c05553fec9cd139f656583c710b6d35396cd4540e5b5e0e87103c64437104"],
  ["s32le", "anull", 4, 201326592, "1a5d6ebd2e3ba7ea4a75524032004d814b0ce4373648d0809d7a536e7427dfb0"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches native ${format} ${filter} overlap precision (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(64 * bytes);
      for (let i = 0; i < 64; i++) {
        const ramp = i % 17 - 8;
        if (format === "s32le") input.writeInt32LE(ramp * 2 ** 26, i * bytes);
        else if (format === "s16le") input.writeInt16LE(ramp * 1024, i * bytes);
        else if (format === "f32le") input.writeFloatLE(ramp / 32, i * bytes);
        else input.writeDoubleLE(ramp / 32, i * bytes);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", format, "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", format, "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 64 * bytes);
      const sample = format === "s32le" ? output.readInt32LE(11 * bytes)
        : format === "s16le" ? output.readInt16LE(11 * bytes)
        : format === "f32le" ? output.readFloatLE(11 * bytes)
        : output.readDoubleLE(11 * bytes);
      assert.equal(sample, sample11);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
