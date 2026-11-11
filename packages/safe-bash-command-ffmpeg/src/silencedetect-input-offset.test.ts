import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: input offsets move silence endpoints and tags, not PCM or durations.
for (const graph of [false, true]) {
  for (const reframe of [false, true]) {
    for (const [offset, reset] of [[0, false], [2, false], [-2, false], [2, true]] as const) {
      it(`preserves silence input timestamps (offset=${offset}, reset=${reset}, reframe=${reframe}, graph=${graph})`, async () => {
        const pcm = Buffer.from("2823000000000000282300000000000000002823000000000000000000000000", "hex");
        const volume = Volume.fromJSON({ "/in.raw": pcm });
        const filter = [
          ...(reframe ? ["asetnsamples=n=4:p=0"] : []),
          ...(reset ? ["asetpts=PTS-STARTPTS"] : []),
          `${graph ? "silencedetect@detector" : "silencedetect"}=n=0.1:d=0.002`,
          "ametadata=print:key=lavfi.silence_start"
        ].join(",");
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1",
            ...(offset ? ["-itsoffset", String(offset)] : []), "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
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
        assert.deepEqual(Buffer.concat(stdout), pcm);
        assert.deepEqual(volume.readFileSync("/in.raw"), pcm);
        const start = reset ? 0 : offset;
        const lines = stderr.trim().split("\n");
        assert.deepEqual(lines.filter(line => line.startsWith("silence_")), [
          `silence_start: ${start + 0.001}`,
          `silence_end: ${start + 0.004} | silence_duration: 0.003`,
          `silence_start: ${start + 0.005}`,
          `silence_end: ${start + 0.009} | silence_duration: 0.004`,
          `silence_start: ${start + 0.01}`,
          `silence_end: ${start + 0.016} | silence_duration: 0.006`
        ]);
        assert.deepEqual(lines.filter(line => line.startsWith("lavfi.")),
          (reframe ? [0.001, 0.005, 0.01] : [0.01]).map(time => `lavfi.silence_start=${start + time}`));
        assert.deepEqual(lines.filter(line => line.startsWith("frame:")).map(line => line.split(" ").filter(Boolean)),
          (reframe ? [0, 1, 2] : [0]).map(n => [
            `frame:${n}`, `pts:${start * 1000 + n * 4}`, `pts_time:${start + n * 0.004}`
          ]));
      });
    }
  }
}
