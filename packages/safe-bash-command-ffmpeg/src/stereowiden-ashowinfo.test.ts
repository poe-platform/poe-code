import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/stereowiden-ashowinfo.wav", import.meta.url));

// Native FFmpeg 7.0.2 intermediate frame checksums and final PCM16 hashes.
for (const graph of [false, true]) {
  for (const [filter, format, checksums] of [
    ["ashowinfo", "s16", ["E562031C", "E562031C", "E562031C"]],
    ["stereowiden,ashowinfo", "flt", ["34050734", "58160808", "58160808"]],
    ["stereowiden,anull,ashowinfo", "flt", ["34050734", "58160808", "58160808"]],
    ["stereowiden,aformat=f=s16,ashowinfo", "s16", ["22F205A4", "A0ED06D1", "A0ED06D1"]]
  ] as const) {
    it(`${filter} reports packed samples before PCM16 encoding (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
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
      assert.deepEqual(stderr.trim().split("\n"), checksums.map((checksum, n) =>
        `[ashowinfo] n:${n} pts:${n * 512} pts_time:${n * 0.064} fmt:${format} channels:2 chlayout:stereo rate:8000 nb_samples:512 checksum:${checksum} plane_checksums: [ ${checksum} ]`));
      assert.equal(createHash("sha256").update(fs.readFileSync("/out.pcm") as Buffer).digest("hex"), filter === "ashowinfo"
        ? "a7e6a6884946ec1109f7b4d893616633f7203278818ae54f439cda05d39d56cc"
        : "28d7b722138fae1e69d85f4200e91b9ee311c0314f4322c9d04a5b0f53ef0637");
    });
  }
}
