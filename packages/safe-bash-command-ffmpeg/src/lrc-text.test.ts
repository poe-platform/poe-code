import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Complete native FFmpeg 7.0.2 WebVTT output, including trailing whitespace.
for (const [prefix, expected] of [
  ["   spaces   ", "spaces   "],
  ["\tword\t", "word\t"],
  [" [00:02.00] next", "next"],
  [" [chorus] line", "chorus] line"],
  ["my [chorus] line", "my [chorus] line"]
]) {
  for (const sync of [false, true]) {
    for (const explicit of [false, true]) {
      it(`${sync ? "sync" : "async"} LRC text ${JSON.stringify(prefix)} (${explicit ? "explicit" : "detected"})`, async () => {
        const volume = Volume.fromJSON({ "/in.lrc": `[00:01.00]${prefix}\n[00:05.00]end\n` });
        const args = ["-v", "error", ...(explicit ? ["-f", "lrc"] : []), "-i", "/in.lrc",
          "-bitexact", "-f", "webvtt", sync ? "/out" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/out", "utf8").toString();
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(output,
          `WEBVTT\n\n00:01.000 --> 00:05.000\n${expected}\n\n00:05.000 --> 1193:02:52.295\nend\n`);
      });
    }
  }
}
