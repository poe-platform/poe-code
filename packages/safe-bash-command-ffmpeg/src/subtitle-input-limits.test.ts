import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 preserves all three cues for input limits while transcoding.
const srtCues = [
  "1\n00:00:01,000 --> 00:00:04,000\nOne\n\n",
  "2\n00:00:02,500 --> 00:00:05,500\nTwo\n\n",
  "3\n00:00:06,000 --> 00:00:07,000\nThree\n\n"
];
const vttCues = [
  "00:01.000 --> 00:04.000\nOne\n",
  "00:02.500 --> 00:05.500\nTwo\n",
  "00:06.000 --> 00:07.000\nThree\n"
];

for (const sync of [false, true]) {
  for (const format of ["srt", "webvtt"]) {
    for (const { name, input, output, count } of [
      { name: "unlimited transcode", input: [], output: [], count: 3 },
      ...["-t", "-to"].flatMap(option => [
        { name: `input ${option} transcode`, input: [option, "3"], output: [], count: 3 },
        { name: `output ${option} transcode`, input: [], output: [option, "3"], count: 2 },
        { name: `input ${option} copy`, input: [option, "3"], output: ["-c:s", "copy"], count: 2 },
        { name: `input ${option} and output limit`, input: [option, "3"], output: ["-t", "2"], count: 1 }
      ])
    ]) {
      it(`${sync ? "sync" : "async"} ${format} ${name}`, async () => {
        const contents = (length: number) => format === "srt"
          ? srtCues.slice(0, length).join("") : "WEBVTT\n\n" + vttCues.slice(0, length).join("\n");
        const volume = Volume.fromJSON({ "/in.sub": contents(3) });
        const args = ["-v", "error", ...input, "-f", format, "-i", "/in.sub", ...output, "-f", format, sync ? "/out.sub" : "pipe:1"];
        let stdout = "";
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, "");
          stdout = volume.readFileSync("/out.sub", "utf8") as string;
        } else {
          let stderr = "";
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
          assert.equal(stderr, "");
        }
        assert.equal(stdout, contents(count));
      });
    }
  }
}
