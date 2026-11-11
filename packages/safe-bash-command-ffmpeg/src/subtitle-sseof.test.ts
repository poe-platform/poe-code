import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 ignores -sseof for standalone SRT/WebVTT: duration is unknown.
const srt = "1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n\n";
const webvtt = "WEBVTT\n\n00:01.000 --> 00:02.000\nA\n";

for (const sync of [false, true]) {
  for (const [format, input, offset] of [["srt", srt, "-1"], ["webvtt", webvtt, "-0.5"]] as const) {
    for (const copy of [false, true]) {
      for (const [level, seek] of [["error", false], ["error", true], ["warning", true]] as const) {
        it(`${sync ? "sync" : "async"} ${format} ${copy ? "copy" : "transcode"} keeps cues (${level}, seek=${seek})`, async () => {
          const path = format === "srt" ? "/in.srt" : "/in.vtt";
          const volume = Volume.fromJSON({ [path]: input });
          const outputFormat = copy ? format : "srt";
          const expected = !copy && format === "webvtt" ? "1\n00:00:01,000 --> 00:00:02,000\nA\n\n" : input;
          const args = ["-v", level, ...(seek ? ["-sseof", offset] : []), "-i", path,
            ...(copy ? ["-c:s", "copy"] : []), "-f", outputFormat, sync ? "/out.sub" : "pipe:1"];
          let stdout = "";
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              file => volume.existsSync(file) ? volume.readFileSync(file) as Buffer : undefined,
              (file, bytes) => { volume.writeFileSync(file, bytes); return true; }), "");
            stdout = volume.readFileSync("/out.sub", "utf8") as string;
          } else {
            let stderr = "";
            const result = await createFfmpegCommand().execute({
              args, cwd: "/", env: {}, signal: new AbortController().signal,
              fs: {
                async readFile(file: string) { return volume.readFileSync(file); },
                async stat(file: string) { return volume.statSync(file); }
              },
              stdin: (async function* () {})(),
              stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
              stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } as never);
            assert.equal(result.exitCode, 0, stderr);
            if (level === "warning") assert.ok(stderr.includes("Cannot use -sseof, file duration not known"), stderr);
            else assert.equal(stderr, "");
          }
          assert.equal(stdout, expected);
          assert.equal(volume.readFileSync(path, "utf8"), input);
        });
      }
    }
  }
}
