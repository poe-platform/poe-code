import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 converts u8 to s16 before afade, then back for pcm_u8.
for (const [filter, format, expected] of [
  ["afade=ns=2", "u8", "80808181"],
  ["anull", "u8", "83838383"],
  ["aformat=sample_fmts=s16,afade=t=in:ns=2", "u8", "80808181"],
  ["afade=ns=2", "s16le", "0000000080018001"],
  ["aformat=sample_fmts=u8p,afade=ns=2", "u8", "80808181"]
] as const) {
  for (const graph of [false, true]) it(`${filter} preserves native ${format} bytes (graph=${graph})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.raw", Buffer.from("83838383", "hex"));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "u8", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", `pcm_${format}`, "-f", format, "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(errors).toString(), "");
    assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
  });
}
