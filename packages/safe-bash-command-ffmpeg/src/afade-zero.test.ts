import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 9.0.1 bytes for signed PCM16 [-105, 1001, 1002, 1003].
for (const [filter, format, expected] of [
  ["afade=ns=3", "f32le", "000000000080263c0000a73c00c0fa3c"],
  ["aformat=sample_fmts=s16p,afade=ns=3", "f32le", "000000000080263c0000a73c00c0fa3c"],
  ["aformat=sample_fmts=s32,afade=ns=3", "f32le", "0000000055d5263c0000a73c00c0fa3c"],
  ["aformat=sample_fmts=s32p,afade=ns=3", "f32le", "0000000055d5263c0000a73c00c0fa3c"],
  ["aformat=sample_fmts=flt,afade=ns=3", "f32le", "0000008055d5263c0000a73c00c0fa3c"],
  ["aformat=sample_fmts=fltp,afade=ns=3", "f32le", "0000008055d5263c0000a73c00c0fa3c"],
  ["aformat=sample_fmts=dbl,afade=ns=3", "f32le", "0000008055d5263c0000a73c00c0fa3c"],
  ["aformat=sample_fmts=dblp,afade=ns=3", "f32le", "0000008055d5263c0000a73c00c0fa3c"],
  ["afade=ns=3", "s16le", "00004d019c02eb03"]
] as const) {
  for (const graph of [false, true]) it(`${filter} exports native ${format} zero bytes (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/in.raw": Buffer.from("97ffe903ea03eb03", "hex") });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(fs.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
  });
}
