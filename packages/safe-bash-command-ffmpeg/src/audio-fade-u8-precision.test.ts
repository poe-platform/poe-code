import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2-static, four unsigned samples of 129 at 8 kHz.
for (const [format, filter, expected] of [
  ["s32le", "afade=ns=3", "0000000055555500aaaaaa0000000001"],
  ["f32le", "afade=ns=3", "00000000abaa2a3babaaaa3b0000003c"],
  ["s16le", "afade=ns=3", "00005500aa000001"],
  ["u8", "afade=ns=3", "80808081"],
  ["s32le", "aformat=sample_fmts=s32,afade=ns=3", "0000000055555500aaaaaa0000000001"],
  ["f32le", "aformat=sample_fmts=flt,afade=ns=3", "00000000abaa2a3babaaaa3b0000003c"],
  ["s32le", "aformat=sample_fmts=s16,afade=ns=3", "00000000000055000000aa0000000001"],
  ["f32le", "aformat=sample_fmts=s16,afade=ns=3", "0000000000002a3b0000aa3b0000003c"],
  ["s32le", "anull", "00000001000000010000000100000001"],
  ["f32le", "anull", "0000003c0000003c0000003c0000003c"]
] as const) {
  for (const graph of [false, true]) it(`unsigned fade to ${format} with ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/in.raw": Buffer.from("81818181", "hex") });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "u8", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(fs.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
  });
}
