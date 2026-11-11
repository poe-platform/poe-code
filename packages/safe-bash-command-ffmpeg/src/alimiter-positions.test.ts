import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// PCM and packet selections verified with native FFmpeg 7.0.2.
const samples = [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000,
  9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000];
const delayed = [0, 0, 0, ...samples.slice(0, 13)];
for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["aselect=eq(pos\\,44)", samples],
    ["alimiter=attack=0.5:level=0", delayed],
    ["alimiter=attack=0.5:level=0,aselect=eq(pos\\,44)", delayed],
    ["alimiter=attack=0.5:level=0,aselect=isnan(pos)", []],
    ["alimiter=attack=0.5:level=0:latency=1,aselect=eq(pos\\,44)", samples.slice(0, 13)],
    ["alimiter=attack=0.5:level=0:latency=1,aselect=isnan(pos)", samples.slice(13)],
    ["alimiter=attack=0.5:level=0:enable=0,aselect=eq(pos\\,44)", samples]
  ] as const) {
    it(`preserves limiter packet positions: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); },
          async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
          async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(stderr, "");
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
