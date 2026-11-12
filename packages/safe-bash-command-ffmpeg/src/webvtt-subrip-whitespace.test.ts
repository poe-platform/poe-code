import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const pipe of sync ? [false] : [false, true]) {
    for (const [label, dialogue, decoded] of [
      ["trailing spaces", "Last  ", "Last  "],
      ["edge tabs", "\tFirst\t", "\tFirst\t"],
      ["leading spaces", "  First", "First"]] as const) {
      for (const copy of [false, true]) {
        it(`${sync ? "sync" : "async"} writes WebVTT ${label} to ${copy ? "WebVTT copy" : "SRT"} ${pipe ? "stdout" : "file"}`, async () => {
          const input = `WEBVTT\n\n00:01.250 --> 00:03.500\n${dialogue}\n\n`;
          const expected = copy
            ? `WEBVTT\n\n00:01.250 --> 00:03.500\n${dialogue}\n`
            : `1\n00:00:01,250 --> 00:00:03,500\n${decoded}\n\n`;
          const volume = Volume.fromJSON({ "/in.vtt": input });
          const target = pipe ? "pipe:1" : "/out";
          const args = ["-v", "error", "-i", "/in.vtt", ...(copy ? ["-c:s", "copy"] : []),
            "-f", copy ? "webvtt" : "srt", target];
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
}
