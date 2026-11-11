import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 intermediate frame checksums and final PCM16 hashes.
for (const graph of [false, true]) {
  for (const [filter, format, checksum] of [
    ["ashowinfo", "s16", "29DC02AE"],
    ["haas,ashowinfo", "dbl", "60A70CD0"],
    ["haas,anull,ashowinfo", "dbl", "60A70CD0"],
    ["haas,aformat=f=s16,ashowinfo", "s16", "EF6907AC"]
  ] as const) {
    it(`${filter} reports packed samples before PCM16 encoding (${graph ? "graph" : "simple"})`, async () => {
      const channels = [new Float64Array(150), new Float64Array(150)];
      channels[0]![0] = 12000 / 32768;
      channels[1]![4] = -8000 / 32768;
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100, channels }));
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
      assert.equal(stderr.trim(),
        `[ashowinfo] n:0 pts:0 pts_time:0 fmt:${format} channels:2 chlayout:stereo rate:44100 nb_samples:150 checksum:${checksum} plane_checksums: [ ${checksum} ]`);
      const pcm = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(pcm.length, 150 * 2 * 2);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), filter === "ashowinfo"
        ? "c1df9e51087b4c1e09044147c8165c503054552604685346cc88535d92793eb8"
        : "58b9bccb185f84fde1040df2933749f81e9c45ae0c5d342ee529896bbfb9590d");
    });
  }
}
