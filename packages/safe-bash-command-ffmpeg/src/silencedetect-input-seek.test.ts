import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: input seeking with -copyts retains the source clock for
// silence events, frame timestamps and metadata, without changing the PCM.
for (const graph of [false, true]) {
  for (const [seek, copyts, starts, ends, durations, framePts] of [
    [true, true, [0.002, 0.005, 0.01], [0.004, 0.009, 0.016], [0.002, 0.004, 0.006], [2, 6, 10]],
    [true, false, [0, 0.003, 0.008], [0.002, 0.007, 0.014], [0.002, 0.004, 0.006], [0, 4, 8]],
    [false, true, [0.001, 0.005, 0.01], [0.004, 0.009, 0.016], [0.003, 0.004, 0.006], [0, 4, 8]]
  ] as const) {
    it(`preserves silence timestamps after input seek=${seek}, copyts=${copyts}, graph=${graph}`, async () => {
      const pcm = Buffer.from("2823000000000000282300000000000000002823000000000000000000000000", "hex");
      const volume = Volume.fromJSON({ "/in.raw": pcm });
      const filter = "asetnsamples=n=4:p=0,silencedetect=n=0.1:d=0.002,ametadata=print:key=lavfi.silence_start";
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1",
          ...(seek ? ["-ss", "0.002"] : []), "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(copyts ? ["-copyts"] : []), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), pcm.subarray(seek ? 4 : 0));
      assert.deepEqual(volume.readFileSync("/in.raw"), pcm);
      const lines = stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line);
      assert.deepEqual(lines.filter(line => line.startsWith("silence_")), starts.flatMap((start, i) => [
        `silence_start: ${start}`,
        `silence_end: ${ends[i]} | silence_duration: ${durations[i]}`
      ]));
      assert.deepEqual(lines.filter(line => line.startsWith("lavfi.")),
        starts.map(start => `lavfi.silence_start=${start}`));
      assert.deepEqual(lines.filter(line => line.startsWith("frame:")).map(line => line.split(" ").filter(Boolean)),
        framePts.map((pts, i) => [`frame:${i}`, `pts:${pts}`, `pts_time:${pts / 1000}`]));
    });
  }
}
