import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseSubtitleDocument } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [dialogue, expected] of [
    ["a\n  b", "a\nb"],
    ["a\n   b  c\n d", "a\nb  c\nd"],
    ["a\n\tb", "a\n\tb"],
    ["a\n\u00a0b", "a\n\u00a0b"],
    ["a\\N  b", "a\n  b"]
  ]) {
    for (const copy of [false, true]) {
      it(`${sync ? "sync" : "async"} ${copy ? "copies" : "transcodes"} SubRip indentation ${JSON.stringify(dialogue)}`, async () => {
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
        const output = parseSubtitleDocument(volume.readFileSync(target) as Buffer, copy ? "srt" : "webvtt");
        assert.deepEqual(output.tracks[0]!.samples.map(sample => [
          sample.pts, sample.duration, new TextDecoder().decode(sample.data)
        ]), [[0, 1000, copy ? dialogue : expected]]);
      });
    }
  }
}
