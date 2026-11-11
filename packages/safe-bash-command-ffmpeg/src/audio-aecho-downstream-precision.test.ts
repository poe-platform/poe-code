import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16, including both samples of the drained echo tail.
const echo = "aecho=0.5:1:0.25:0.5";
for (const [downstream, format, floating, integer] of [
  ["afade=t=in:ns=1,volume=2", "fltp", [0, -2003, 4006, -6010, 3005, -4007], [0, -2002, 4006, -6010, 3004, -4006]],
  ["aeval=val(ch):c=same,volume=2", "dblp", [1001, -2003, 4006, -6010, 3005, -4007], [1000, -2002, 4006, -6010, 3004, -4006]],
  ["acontrast=0,volume=2", "fltp", [1572, -3145, 6283, -9408, 4716, -6285], [1571, -3144, 6283, -9408, 4715, -6283]],
  ["anull,volume=2", "fltp", [1001, -2003, 4006, -6010, 3005, -4007], [1000, -2002, 4006, -6010, 3004, -4006]]
] as const) {
  for (const [filter, expected] of [
    [`${echo},${downstream}`, floating],
    [`aformat=sample_fmts=${format},${echo},${downstream}`, floating],
    [`aformat=sample_fmts=s16p,${echo},${downstream}`, integer],
    [`${echo},aformat=sample_fmts=s16p,${downstream}`, integer]
  ] as const) {
    for (const graph of [false, true]) {
      it(`negotiates echo precision for ${filter} (graph=${graph})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from([1001, -2003, 3005, -4007], sample => sample / 32768)
        ] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.pcm"],
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
        assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
      });
    }
  }
}
