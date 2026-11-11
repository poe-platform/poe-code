import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [filter, output, frames] of [
  ["anull,ashowinfo", "000100020003000400050006000700080009000a", [
    "n:0 pts:0 pts_time:0 fmt:s16 channels:1 chlayout:mono rate:8000 nb_samples:10 checksum:01810037 plane_checksums: [ 01810037 ]"
  ]],
  ["asetnsamples=n=4:p=0,areverse,ashowinfo", "000a000900080007000600050004000300020001", [
    "n:0 pts:0 pts_time:0 fmt:s16 channels:1 chlayout:mono rate:8000 nb_samples:2 checksum:00270013 plane_checksums: [ 00270013 ]",
    "n:1 pts:2 pts_time:0.00025 fmt:s16 channels:1 chlayout:mono rate:8000 nb_samples:4 checksum:0072001A plane_checksums: [ 0072001A ]",
    "n:2 pts:6 pts_time:0.00075 fmt:s16 channels:1 chlayout:mono rate:8000 nb_samples:4 checksum:0032000A plane_checksums: [ 0032000A ]"
  ]]
] as const) {
  it(`${filter} matches FFmpeg 7 frame fields and PCM`, async () => {
    const fs = Volume.fromJSON({ "/in.raw": Buffer.from("000100020003000400050006000700080009000a", "hex") });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", "-af", filter, "-f", "s16le", "/out.raw"],
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
    assert.deepEqual(stderr.trim().split("\n"), frames.map(frame => `[ashowinfo] ${frame}`));
    assert.equal((fs.readFileSync("/out.raw") as Buffer).toString("hex"), output);
  });
}
