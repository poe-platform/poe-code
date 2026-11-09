import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 extraction from the independent native WebM fixtures.
const expected = "WEBVTT\n\nspeaker-a\n00:00.125 --> 00:00.625 align:start position:20%\nFirst line.\n\n00:00.750 --> 00:01.000\nSecond line.\n";
for (const kind of ["subtitles", "captions", "descriptions", "metadata"]) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} copies native WebVTT ${kind}`, async () => {
      const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/webvtt-${kind}.webm`, import.meta.url));
      const volume = Volume.fromJSON({ "/in.webm": input });
      const args = ["-v", "error", "-y", "-i", "/in.webm", ...(sync ? [] : ["-map", "0:s:0"]), "-c", "copy", "/out.vtt"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(volume.readFileSync("/out.vtt", "utf8"), expected);
    });
  }
}
