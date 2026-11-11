import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 records for the original stereo frame and echo drain.
for (const graph of [false, true]) {
  for (const [filter, format, checksum, planes] of [
    ["aecho=0.5:0.5:1:0.5", "s16p", "3DFA03C2", "132901D7 0D6101EB"],
    ["aecho=0.5:0.5:1:0.5,anull", "s16p", "3DFA03C2", "132901D7 0D6101EB"],
    ["aecho=0.5:0.5:1:0.5,aformat=f=s16", "s16", "3F4803C2", "3F4803C2"],
    ["anull", "s16", "3F9D040D", "3F9D040D"]
  ] as const) {
    it(`${filter} reports stereo checksums (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([16000, 0, 0, 0, -8000, 0, 0, 0], value => value / 32768),
        Float64Array.from([0, 0, 8000, 0, 0, 0, -4000, 0], value => value / 32768)
      ] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter},ashowinfo[out]`, "-map", "[out]"]
          : ["-af", `${filter},ashowinfo`]), "-f", "s16le", "/out.pcm"],
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
      const pcm = fs.readFileSync("/out.pcm") as Buffer;
      if (filter === "anull") {
        assert.equal(pcm.toString("hex"), "803e0000000000000000401f00000000c0e0000000000000000060f000000000");
      } else {
        assert.equal(pcm.length, 64);
        assert.equal(createHash("sha256").update(pcm).digest("hex"),
          "1048ce2da23745ca9a4cd9139f9ef2a04e69ccd75c34db8e9b3204db92a07f11");
      }
      assert.deepEqual(stderr.trim().split("\n"), Array.from({ length: filter === "anull" ? 1 : 2 }, (_, n) =>
        `[ashowinfo] n:${n} pts:${n * 8} pts_time:${n * 0.001} fmt:${format} channels:2 chlayout:stereo rate:8000 nb_samples:8 checksum:${checksum} plane_checksums: [ ${planes} ]`));
    });
  }
}
