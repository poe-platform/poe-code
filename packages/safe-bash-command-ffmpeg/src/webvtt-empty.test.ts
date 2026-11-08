import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [name, input] of [
    ["empty cue before text", "00:01.000 --> 00:02.000\n\n00:03.000 --> 00:04.000\nGood\n"],
    ["empty final cue", "00:01.000 --> 00:02.000\nGood\n\n00:03.000 --> 00:04.000\n\n"],
    ["only empty cue with side data", "empty\n00:01.000 --> 00:02.000 align:start\n\n"]
  ] as const) {
    it(`${sync ? "sync" : "async"} preserves empty WebVTT cues (${name})`, async () => {
      const volume = Volume.fromJSON({ "/in.vtt": "WEBVTT\n\n" + input });
      const args = ["-v", "error", "-y", "-i", "/in.vtt", ...(sync ? [] : ["-map", "0:s:0"]), "-c:s", "copy", "/out.vtt"];
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
      assert.equal(volume.readFileSync("/out.vtt", "utf8"), "WEBVTT\n\n" + input.replace("02.000\n\n00:03", "02.000\n\n\n00:03"));
    });
  }
}
