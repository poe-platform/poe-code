import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16 at 1000 Hz, including the complete echo tail.
const floating = [561, 0, 248, -1122, 0, 0, 0, 0, -824, 0, 75, 0, 0, 150, 0, 0];
const integer = [560, 0, 248, -1121, 0, 0, 0, 0, -823, 0, 75, 0, 0, 150, 0, 0];
for (const middle of [
  "", "anull,", "atrim=start_sample=0,", "asetpts=PTS,",
  "asetnsamples=n=4:p=0,", "areverse,", "apad=pad_len=0,",
  "atrim@trim=start_sample=0,asetpts@clock=PTS,asetnsamples@frames=n=4:p=0,apad@pad=pad_len=0,"
]) {
  for (const [suffix, samples] of [
    ["volume=1", floating],
    ["volume=1:precision=double", floating],
    ["volume=1:precision=fixed", integer],
    ["aformat=s16p,volume=1", integer]
  ] as const) {
    for (const graph of [false, true]) {
      it(`echo preserves negotiated precision through ${middle}${suffix} (${graph ? "graph" : "simple"})`, async () => {
        const input = [1001, 0, 0, -2003, 0, 0, 0, 0, 303, 0, 0];
        const bytes = Buffer.alloc(input.length * 2);
        input.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
        const fs = Volume.fromJSON({ "/in.raw": bytes });
        let stderr = "";
        const filter = `aecho=0.7:0.8:2|5:0.31|0.62,${middle}${suffix}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = fs.readFileSync("/out.raw") as Buffer;
        const expected = middle === "areverse," ? [...samples].reverse() : samples;
        assert.equal(output.length, expected.length * 2);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      });
    }
  }
}
