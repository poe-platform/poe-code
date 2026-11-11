import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = "1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n";
// Native FFmpeg 7.0.2 reference outputs. Copied SRT uses milliseconds;
// encoded SubRip packets use microseconds, rounded to milliseconds by the muxer.
for (const sync of [false, true]) for (const copy of [false, true]) {
  for (const [filter, expected] of [
    ["null", `${input}\n`],
    ["setts=pts=PTS+500", copy
      ? "1\n00:00:01,500 --> 00:00:02,500\nA\n\n2\n00:00:03,500 --> 00:00:04,500\nB\n\n"
      : "1\n00:00:01,001 --> 00:00:02,001\nA\n\n2\n00:00:03,001 --> 00:00:04,001\nB\n\n"],
    ["setts=duration=DURATION/2", "1\n00:00:01,000 --> 00:00:01,500\nA\n\n2\n00:00:03,000 --> 00:00:03,500\nB\n\n"],
    ["null,setts=pts=PTS+0.5/TB:duration=DURATION/2,null", "1\n00:00:01,500 --> 00:00:02,000\nA\n\n2\n00:00:03,500 --> 00:00:04,000\nB\n\n"]
  ] as const) it(`applies subtitle ${filter} (sync=${sync}, copy=${copy})`, async () => {
    const volume = Volume.fromJSON({ "/in.srt": input });
    const args = ["-v", "error", "-i", "/in.srt", ...(copy ? ["-c:s", "copy"] : []),
      "-bsf:s", filter, "-f", "srt", sync ? "/out.srt" : "pipe:1"];
    let stdout = "", stderr = "";
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      stdout = volume.readFileSync("/out.srt", "utf8") as string;
    } else {
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
    assert.equal(volume.readFileSync("/in.srt", "utf8"), input);
  });
}
