import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const format of ["srt", "webvtt"]) {
  const original = format === "srt"
    ? "1\n00:00:01,000 --> 00:00:04,000\nOne\n\n2\n00:00:02,500 --> 00:00:05,500\nTwo\n\n3\n00:00:06,000 --> 00:00:07,000\nThree\n\n"
    : "WEBVTT\n\n00:01.000 --> 00:04.000\nOne\n\n00:02.500 --> 00:05.500\nTwo\n\n00:06.000 --> 00:07.000\nThree\n";
  const after = format === "srt"
    ? "1\n00:00:02,500 --> 00:00:05,500\nTwo\n\n2\n00:00:06,000 --> 00:00:07,000\nThree\n\n"
    : "WEBVTT\n\n00:02.500 --> 00:05.500\nTwo\n\n00:06.000 --> 00:07.000\nThree\n";
  for (const sync of [false, true]) {
    for (const seek of ["none", "input", "output"]) {
      it(`${sync ? "sync" : "async"} ${format} ${seek} seek selects whole cues with copyts`, async () => {
        const volume = Volume.fromJSON({ "/in": original });
        const args = ["-v", "error", ...(seek === "input" ? ["-ss", "2"] : []),
          "-f", format, "-i", "/in", ...(seek === "output" ? ["-ss", "2"] : []),
          "-copyts", "-f", format, sync ? "/out" : "pipe:1"];
        const expected = seek === "output" ? after : original;
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          assert.equal(volume.readFileSync("/out", "utf8"), expected);
          return;
        }
        let stdout = "";
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); } },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.equal(stdout, expected);
      });
    }
  }
}
