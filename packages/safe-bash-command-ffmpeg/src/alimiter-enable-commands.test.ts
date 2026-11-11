import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000, 9000, -10000, 11000, -12000, 13000, -14000, 15000, -16000];
const delayed = [0, 0, 0, ...samples.slice(0, -3)];
const bypassed = [0, 0, 0, 1000, ...samples.slice(4)];

for (const graph of [false, true]) {
  for (const [schedule, limiter, expected] of [
    // The second-frame bypass reference comes from native FFmpeg 7.0.2.
    ["0.0005 alimiter enable 0", "alimiter", bypassed],
    ["0.0006 alimiter enable 0", "alimiter", [...delayed.slice(0, 8), ...samples.slice(8)]],
    ["0.0005 alimiter@cap enable 0", "alimiter@cap", bypassed],
    ["0.0005 alimiter@other enable 0", "alimiter@cap", delayed],
    ["0.0005 alimiter enable 0;0.001 alimiter enable 1", "alimiter",
      [...bypassed.slice(0, 8), -2000, 3000, -4000, 9000, -10000, 11000, -12000, 13000]],
    ["0.0005 alimiter enable not(n)", "alimiter", bypassed],
    ["0.0005 alimiter enable 0;0.001 alimiter enable invalid", "alimiter", bypassed],
    ["0.0005 alimiter enable invalid", "alimiter", delayed],
    ["", "alimiter", delayed],
    ["", "alimiter=enable=not(n)", bypassed]
  ] as const) {
    it(`applies limiter timeline commands ${schedule || limiter} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] })) });
      const filter = `asetnsamples=n=4:p=0,${schedule ? `asendcmd=c='${schedule}',` : ""}${limiter}${limiter.includes("=") ? ":" : "="}attack=0.5:level=0`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
