import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const format of ["srt", "webvtt"]) {
  const original = format === "srt"
    ? "1\n00:00:01,000 --> 00:00:04,000\nOne\n\n2\n00:00:02,500 --> 00:00:05,500\nTwo\n\n3\n00:00:06,000 --> 00:00:07,000\nThree\n\n"
    : "WEBVTT\n\n00:01.000 --> 00:04.000\nOne\n\n00:02.500 --> 00:05.500\nTwo\n\n00:06.000 --> 00:07.000\nThree\n";
  const shifted = format === "srt"
    ? "1\n00:00:00,000 --> 00:00:03,000\nOne\n\n2\n00:00:01,500 --> 00:00:04,500\nTwo\n\n3\n00:00:05,000 --> 00:00:06,000\nThree\n\n"
    : "WEBVTT\n\n00:00.000 --> 00:03.000\nOne\n\n00:01.500 --> 00:04.500\nTwo\n\n00:05.000 --> 00:06.000\nThree\n";
  for (const sync of [false, true]) {
    for (const [seek, copyts] of [[1, false], [1, true], [0, false]] as const) {
      it(`${sync ? "sync" : "async"} ${format} input seek ${seek}, copyts=${copyts}`, async () => {
        const volume = Volume.fromJSON({ "/in": original });
        const args = ["-v", "error", "-ss", String(seek), "-f", format, "-i", "/in",
          ...(copyts ? ["-copyts"] : []), "-f", format, sync ? "/out" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
          stdout = volume.readFileSync("/out", "utf8") as string;
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: { async readFile(path: string) { return volume.readFileSync(path); } },
            stdin: (async function* () {})(),
            stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(stdout, seek === 1 && !copyts ? shifted : original);
      });
    }
  }
}
