import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2-static PCM16 output for the same deterministic input.
for (const [layout, channels, hash] of [
  ["mono", 1, "2eb9feb1a6e571e17473a52ccbcdf3b148570c85cd95244e80e6a1c7a419420c"],
  ["quad", 4, "d28083bcb7fd74842d5c41cd5537e52789ceb54bb9508fa377f26fa7dd500467"],
  ["5.1", 6, "8d82312d39acd7d039072707f42d698bb0df572f757e9e945deef7b0e6a7267c"],
  ["7.1", 8, "e48e507084f89134277cd533b4af6aebf66e2a07bb15a0411bd29cb36ee59288"],
  ["stereo", 2, "8a9b2d61432a352de91e63c3a32eb0dc1a4efabb5491f0a941c153c5246136ce"]
] as const) for (const explicit of [false, true]) for (const graph of [false, true]) {
  it(`virtualbass remixes ${layout} (explicit=${explicit}, graph=${graph})`, async () => {
    const input = Buffer.alloc(4800);
    for (let i = 0; i < 2400; i++) input.writeInt16LE(i * 7919 % 22001 - 11000, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const filter = `${explicit ? "aformat=channel_layouts=stereo:sample_fmts=dblp," : ""}virtualbass`;
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", layout, "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(errors).toString(), "");
    const pcm = Buffer.concat(output);
    assert.equal(pcm.length, 2400 / channels * 3 * 2);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
