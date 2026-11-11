import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/crossfeed-ashowinfo.wav", import.meta.url));

// Frame checksums and final PCM16 hashes verified with native FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const [filter, format, checksums] of [
    ["ashowinfo", "s16", ["7F990344", "7F990344", "CFA40272"]],
    ["crossfeed,ashowinfo", "dbl", ["C28B65D2", "18D94ED4", "1B5D4293"]],
    ["crossfeed,anull,ashowinfo", "dbl", ["C28B65D2", "18D94ED4", "1B5D4293"]],
    ["crossfeed,aformat=f=s16,ashowinfo", "s16", ["D8CC1799", "D6F41799", "FAD614AA"]]
  ] as const) {
    it(`${filter} reports intermediate frames before PCM16 encoding (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(p: string) { return fs.readFileSync(p); },
          async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
          async stat(p: string) { return fs.statSync(p); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(stderr.trim().split("\n"), checksums.map((checksum, n) =>
        `[ashowinfo] n:${n} pts:${n * 512} pts_time:${n * 0.064} fmt:${format} channels:2 chlayout:stereo rate:8000 nb_samples:${n === 2 ? 76 : 512} checksum:${checksum} plane_checksums: [ ${checksum} ]`));
      const pcm = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(pcm.length, 1100 * 2 * 2);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), filter === "ashowinfo"
        ? "9d6db9c7be68060598c423b31a832c1f5e9397a64ccd6c3c65cc3238a8b48c64"
        : "4092fe57750ebd52b5a5b82e9a0f890dc4b6a3598543430f28cf864f118ec8c2");
    });
  }
}
