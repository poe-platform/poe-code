import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const output of ["srt", "vtt", "copy"] as const) {
    it(`${sync ? "sync" : "async"} handles literal WebVTT backslash-n when writing ${output}`, async () => {
      const input = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLine\\nnext\n";
      const volume = Volume.fromJSON({ "/in.vtt": input });
      const target = `/out.${output === "copy" ? "vtt" : output}`;
      const args = ["-v", "error", "-y", "-i", "/in.vtt",
        ...(output === "copy" ? ["-c:s", "copy"] : []), target];
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
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      // Native FFmpeg uses CRLF inside the SRT cue and LF in the VTT cue.
      const expected = output === "srt"
        ? "1\n00:00:00,000 --> 00:00:01,000\nLine\r\nnext\n\n"
        : `WEBVTT\n\n00:00.000 --> 00:01.000\n${output === "copy" ? "Line\\nnext" : "Line\nnext"}\n`;
      assert.equal(volume.readFileSync(target, "utf8"), expected);
    });
  }
}
