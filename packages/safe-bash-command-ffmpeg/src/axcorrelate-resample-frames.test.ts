import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 s16le output for these square waves.
for (const [rate, explicit, select, bytes, sha256] of [
  [16000, false, false, 1024, "d006dd7565b77b47f609ed151d2e4fb78a52e235e3552c48f3e8567650d1d7d0"],
  [16000, true, false, 1024, "d006dd7565b77b47f609ed151d2e4fb78a52e235e3552c48f3e8567650d1d7d0"],
  [16000, false, true, 32, "1cca852151226c37acccc974a40be52b06b7989ae35cc37e61c8c3de5b7546bb"],
  [16000, true, true, 32, "1cca852151226c37acccc974a40be52b06b7989ae35cc37e61c8c3de5b7546bb"],
  [8000, false, false, 1024, "f566df70d065cc08002cfd731311881a19421a8ffb7271104caf702ef72dc19d"]
] as const) {
  it(`axcorrelate preserves native PCM and frames (${rate} Hz, explicit=${explicit}, select=${select})`, async () => {
    const fs = Volume.fromJSON({});
    for (const [name, count, period] of [["a", 512, 3], ["b", 4800, 4]] as const) {
      const pcm = Buffer.alloc(count * 2);
      for (let i = 0; i < count; i++) pcm.writeInt16LE(Math.floor(i / period) % 2 ? 8192 : -8192, i * 2);
      fs.writeFileSync(`/${name}.raw`, pcm);
    }
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const graph = `${explicit ? "[1:a]aresample=8000[y];[0:a][y]" : "[0:a][1:a]"}`
      + `axcorrelate=size=32:algo=fast${select ? ",aselect=eq(n\\,1)" : ""}[out]`;
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", "mono", "-i", "/a.raw",
        "-f", "s16le", "-ar", String(rate), "-ch_layout", "mono", "-i", "/b.raw",
        "-filter_complex", graph, "-map", "[out]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout.push(data); } },
      stderr: { async write(data: Uint8Array) { stderr.push(data); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stderr).toString(), "");
    const pcm = Buffer.concat(stdout);
    assert.equal(pcm.length, bytes);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), sha256);
  });
}
