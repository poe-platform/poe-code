import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output hashes from FFmpeg 7.0.2, mono at 8 kHz.
for (const [filter, hash] of [
  ["asoftclip=type=exp:oversample=64", "5c633aa8048567c98cda837d117ef7b74c266a29ea06b917c642bc3389f6b216"],
  ["asoftclip=type=exp:oversample=63", "aeea1a109f68631e00c6faef69c6f2960a8c2b86122e05c45b8db37be3033b41"],
  ["asoftclip=type=exp:oversample=1", "3a8f003ffbc2b6a32bd9f4927728bd7c716a92c3c9faf0c4aac1c63b9fb25e89"],
  ["asoftclip=type=hard:oversample=64", "d34be3ec1aa930aa42e9992fec10ebc934eccfec28e635df57b54b83fea3458b"],
  ["asetnsamples=n=4:p=0,asoftclip=type=exp:oversample=64", "5c633aa8048567c98cda837d117ef7b74c266a29ea06b917c642bc3389f6b216"],
  ["aformat=sample_fmts=dblp,asoftclip=type=exp:oversample=64", "08d56bfa38feb71de4f366f415c8edb76f3bb64327b1d9d0b8e49146ed924120"]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native PCM16 rounding (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(64);
    for (let i = 0; i < 32; i++) input.writeInt16LE((i * 1751) % 42001 - 21000, i * 2);
    const fs = Volume.fromJSON({ "/in.pcm": input });
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const pcm = Buffer.concat(output);
    assert.equal(pcm.length, input.length);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
