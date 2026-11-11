import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: command times truncate to microseconds, frame PTS round.
for (const complex of [false, true]) {
  for (const [rate, time, expected] of [
    [8000, "0.0010009", [1000, 2000, 2000, 2000]],
    [8000, "0.001", [1000, 2000, 2000, 2000]],
    [8000, "0.001001", [1000, 1000, 2000, 2000]],
    [8000, "0.0000009", [2000, 2000, 2000, 2000]],
    [8000, "0.000001", [1000, 2000, 2000, 2000]],
    [44100, "0.000363", [1000, 1000, 2000, 2000]],
    [44100, "0.000364", [1000, 1000, 1000, 2000]],
    [44100, "0.000182", [1000, 1000, 2000, 2000]]
  ] as const) {
    it(`dispatches ${time} at microsecond frame boundaries at ${rate} Hz (${complex ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: rate,
        channels: [new Float64Array(32).fill(1000 / 32768)] }));
      const filter = `asetnsamples=n=8:p=0,asendcmd=c='${time} volume@v volume 2',volume@v=1`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(complex
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
      const output = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(output.length, 64);
      assert.deepEqual(Array.from({ length: 32 }, (_, i) => output.readInt16LE(i * 2)),
        expected.flatMap(value => Array<number>(8).fill(value)));
    });
  }
}
