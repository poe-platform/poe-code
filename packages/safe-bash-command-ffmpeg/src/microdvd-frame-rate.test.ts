import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const header of ["25", "25 fps"]) {
  for (const explicit of [false, true]) {
    for (const sync of [false, true]) {
      for (const copy of [false, true]) {
        it(`${sync ? "sync" : "async"} ${explicit ? "explicit" : "detected"} MicroDVD ${copy ? "copy" : "SRT"} consumes a ${header} header`, async () => {
          const input = `{1}{1}${header}\n{25}{50}Hello\n`;
          const volume = Volume.fromJSON({ "/input.sub": input });
          const args = ["-v", "error", ...(explicit ? ["-f", "microdvd"] : []), "-i", "/input.sub",
            ...(copy ? ["-c:s", "copy"] : []), "-f", copy ? "microdvd" : "srt", sync ? "/output" : "pipe:1"];
          let stdout = "";
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined,
              path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
              (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
            stdout = volume.readFileSync("/output", "utf8").toString();
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
          assert.equal(stdout, copy ? "{25}{50}Hello\n" : "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n");
          assert.equal(volume.readFileSync("/input.sub", "utf8"), input);
        });
      }
    }
  }
}
