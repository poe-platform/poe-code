import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const title of ["A\nB", "A B"]) {
    it(`writes the native LRC header for title=${JSON.stringify(title)}, sync=${sync}`, async () => {
      const input = "WEBVTT\n\n00:01.000 --> 00:02.500\nhello\n";
      const volume = Volume.fromJSON({ "/in.vtt": input });
      const args = ["-v", "error", "-i", "/in.vtt", "-bitexact", "-metadata", `title=${title}`,
        "-f", "lrc", sync ? "/out.lrc" : "pipe:1"];
      let stdout = "";
      let stderr = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out.lrc", "utf8") as string;
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
      // Complete output captured from native FFmpeg 7.0.2 with -bitexact.
      assert.equal(stdout, "[ti:A B]\n\n[00:01.00]hello\n");
      assert.equal(volume.readFileSync("/in.vtt", "utf8"), input);
    });
  }
}
