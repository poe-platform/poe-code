import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [dialogue, expected] of [
    ["one<br>two<br/>three", "one\ntwo\nthree"],
    ["one<BR>two<br />three", "one\ntwo\nthree"],
    ["<b>one<br>two</b><br/>three", "<b>one\ntwo</b>\nthree"]
  ]) {
    for (const copy of [false, true]) {
      it(`${sync ? "sync" : "async"} ${copy ? "copies" : "transcodes"} SubRip HTML line breaks ${JSON.stringify(dialogue)}`, async () => {
        const volume = Volume.fromJSON({ "/in.srt": `1\n00:00:00,000 --> 00:00:01,000\n${dialogue}\n\n` });
        const target = copy ? "/out.srt" : "/out.vtt";
        const args = ["-v", "error", "-y", "-i", "/in.srt", ...(copy ? ["-c:s", "copy"] : []), target];
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
        assert.equal(volume.readFileSync(target, "utf8"), copy
          ? `1\n00:00:00,000 --> 00:00:01,000\n${dialogue}\n\n`
          : `WEBVTT\n\n00:00.000 --> 00:01.000\n${expected}\n`);
      });
    }
  }
}
