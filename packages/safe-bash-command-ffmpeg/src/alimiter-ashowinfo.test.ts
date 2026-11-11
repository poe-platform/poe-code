import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Packed double checksums verified with native FFmpeg 9.0.1.
for (const graph of [false, true]) {
  for (const [scales, checksums] of [
    [[1], ["2B543CB2", "32DD707F"]],
    [[1, -1], ["F48465F3", "3B260D0D"]]
  ] as const) {
    for (const suffix of ["ashowinfo", "anull,ashowinfo"]) {
      it(`reports packed limiter doubles for ${scales.length} channels (${graph ? "graph" : "simple"}, ${suffix})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: scales.map(scale => Float64Array.from({ length: 600 }, (_, i) => scale * (100 + i) / 32768)) }));
        const filter = `alimiter=latency=0,${suffix}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); },
            async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
            async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(stderr.trim().split("\n"), [
          ...(scales.length === 1 ? ["ffmpeg: Guessed Channel Layout: mono"] : []),
          ...checksums.map((checksum, n) =>
            `[ashowinfo] n:${n} pts:${n * 512} pts_time:${n * 0.064} fmt:dbl channels:${scales.length} chlayout:${scales.length === 1 ? "mono" : "stereo"} rate:8000 nb_samples:${n ? 88 : 512} checksum:${checksum} plane_checksums: [ ${checksum} ]`)
        ]);
        const pcm = fs.readFileSync("/out.pcm") as Buffer;
        assert.equal(pcm.length, 600 * scales.length * 2);
        for (let i = 0; i < 600; i++) for (const [c, scale] of scales.entries()) {
          assert.equal(pcm.readInt16LE((i * scales.length + c) * 2), i < 39 ? 0 : scale * (100 + i - 39));
        }
      });
    }
  }
}
