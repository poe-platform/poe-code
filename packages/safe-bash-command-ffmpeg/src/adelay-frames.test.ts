import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Frame sizes and timestamps verified with native FFmpeg's ashowinfo.
for (const scenario of [
  { delays: [100], length: 8192, prefix: "", pts: 0, frames: [100, ...Array<number>(16).fill(512)] },
  { delays: [0], length: 8192, prefix: "", pts: 0, frames: Array<number>(16).fill(512) },
  { delays: [3000, 5500], length: 800, prefix: "asetnsamples=n=512:p=0,asetpts=PTS+800,", pts: 800,
    frames: [2048, 952, 512, 288, 2048, 452] },
  { delays: [100], length: 800, prefix: "asetnsamples=n=300:p=0,", pts: 0, frames: [100, 300, 300, 200] },
  { delays: [100], length: 800, prefix: "asetnsamples=n=300:p=0,asetpts=PTS*2,", pts: [0, 100, 700, 1300], frames: [100, 300, 300, 200] }
]) {
  for (const expression of ["n", "t", "1"]) {
    it(`evaluates volume=${expression} on adelay=${scenario.delays.join("|")} frames after ${scenario.prefix || "input"}`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: scenario.delays.map(() => new Float64Array(scenario.length).fill(12000 / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", "-af",
          `${scenario.prefix}adelay=${scenario.delays.map(delay => `${delay}S`).join("|")},volume=${expression}:eval=frame`,
          "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); },
          async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
          async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData;
      for (const [channel, delay] of scenario.delays.entries()) {
        let start = 0;
        const expected = scenario.frames.flatMap((count, n) => {
          const pts = Array.isArray(scenario.pts) ? scenario.pts[n]! : scenario.pts + start;
          const gain = expression === "n" ? n : expression === "t" ? pts / 8000 : 1;
          const values = Array.from({ length: count }, (_, i) => start + i < delay || start + i >= delay + scenario.length
            ? 0 : Math.min(32767, Math.round(Math.fround(Math.fround(gain) * (12000 / 32768)) * 32768)));
          start += count;
          return values;
        });
        assert.equal(actual[channel]!.length, scenario.length + Math.max(...scenario.delays));
        assert.deepEqual(Array.from(actual[channel]!, value => Math.round(value * 32768)), expected);
      }
    });
  }
}
