import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 outputs, including the one-frame echo tail.
for (const [format, length, hash] of [
  ["s16le", 1540, "0c188cfaff66bbad076753adbf8202aae8ecb8056c970d5051a4a14046d51a0f"],
  ["f64le", 6160, "d21a6a98b02bd8c97829651f4adc50aefee879fb788499f20b697c59fd774d7d"]
] as const) {
  for (const filter of [
    "aecho=0.8:0.6:1:0.3,flanger",
    "aformat=dblp,aecho=0.8:0.6:1:0.3,flanger",
    "aecho=0.8:0.6:1:0.3,aformat=dblp,flanger",
    "aecho=0.8:0.6:1:0.3,anull,acopy,flanger@effect"
  ]) {
    for (const graph of [false, true]) {
      it(`${filter} negotiates native ${format} precision (graph=${graph})`, async () => {
        const volume = Volume.fromJSON({});
        const input = Buffer.alloc(768 * 2);
        for (let i = 0; i < 768; i++) input.writeInt16LE(i * 1371 % 60001 - 30000, i * 2);
        volume.writeFileSync("/in.pcm", input);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", format, "/out.pcm"],
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
        assert.equal(stderr, "");
        const pcm = volume.readFileSync("/out.pcm") as Buffer;
        assert.equal(pcm.length, length);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      });
    }
  }
}
