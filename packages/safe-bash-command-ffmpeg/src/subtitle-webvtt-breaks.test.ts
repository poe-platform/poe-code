import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const dialogue of ["A\\NB", "A\\nB"]) {
    for (const format of ["srt", "webvtt"]) {
      for (const copy of format === "webvtt" ? [false, true] : [false]) {
        it(`${sync ? "sync" : "async"} ${copy ? "copies" : "decodes"} WebVTT ${JSON.stringify(dialogue)} to ${format}`, async () => {
          const volume = Volume.fromJSON({ "/in.vtt": `WEBVTT\n\n00:01.250 --> 00:03.500\n${dialogue}\n\n` });
          const args = ["-v", "error", "-i", "/in.vtt", ...(copy ? ["-c:s", "copy"] : []), "-f", format, sync ? "/out" : "pipe:1"];
          let stdout = "";
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
              (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
            stdout = volume.readFileSync("/out", "utf8") as string;
          } else {
            let stderr = "";
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
            assert.equal(stderr, "");
          }
          const text = copy ? dialogue : format === "srt" ? "A\r\nB" : "A\nB";
          assert.equal(stdout, format === "srt"
            ? `1\n00:00:01,250 --> 00:00:03,500\n${text}\n\n`
            : `WEBVTT\n\n00:01.250 --> 00:03.500\n${text}\n`);
        });
      }
    }
  }
}
