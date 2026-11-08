import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const prefix of ["", "01:"]) {
    it(`${sync ? "sync" : "async"} reads WebVTT ${prefix}00:01.2 as integer milliseconds`, async () => {
      const volume = Volume.fromJSON({ "/in.vtt": `WEBVTT\n\n${prefix}00:01.2 --> ${prefix}00:02.34\nHello\n\n${prefix}00:03.1234 --> ${prefix}00:05.0020\nWorld\n` });
      const args = ["-v", "error", "-y", "-i", "/in.vtt", ...(sync ? [] : ["-map", "0:s:0"]), "-c:s", "copy", "/out.vtt"];
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
      assert.equal(volume.readFileSync("/out.vtt", "utf8"),
        `WEBVTT\n\n${prefix}00:01.002 --> ${prefix}00:02.034\nHello\n\n${prefix}00:04.234 --> ${prefix}00:05.020\nWorld\n`);
    });
  }
}
