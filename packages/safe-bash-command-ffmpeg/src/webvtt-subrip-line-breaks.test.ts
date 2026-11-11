import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const pipe of sync ? [false] : [false, true]) {
    for (const mode of ["multiline", "single-line", "copy"] as const) {
      it(`${sync ? "sync" : "async"} writes ${mode} WebVTT dialogue to ${pipe ? "stdout" : "file"} with native line endings`, async () => {
        const dialogue = mode === "single-line" ? "hello" : "hello\nworld";
        const input = `WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start position:20%\n${dialogue}\n\n`;
        const expected = mode === "copy"
          ? "WEBVTT\n\ncue-1\n00:01.000 --> 00:02.500 align:start position:20%\nhello\nworld\n"
          : `1\n00:00:01,000 --> 00:00:02,500\n${mode === "single-line" ? "hello" : "hello\r\nworld"}\n\n`;
        const volume = Volume.fromJSON({ "/in.vtt": input });
        const target = pipe ? "pipe:1" : "/out";
        const args = ["-v", "error", "-i", "/in.vtt", ...(mode === "copy" ? ["-c:s", "copy"] : []),
          "-f", mode === "copy" ? "webvtt" : "srt", target];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(stdout, pipe ? expected : "");
        if (!pipe) assert.equal(volume.readFileSync(target, "utf8"), expected);
      });
    }
  }
}
