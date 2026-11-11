import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    for (const [dialogue, expected] of [
      ["  Alpha", "Alpha"],
      ["Alpha  ", "Alpha  "],
      ["  Alpha  ", "Alpha  "],
      ["  Alpha  |  Beta  ", "Alpha  \n  Beta  "],
      ["  \t Alpha  ", "\t Alpha  "],
      ["  \u00a0Alpha  ", "\u00a0Alpha  "]
    ]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} PJS to WebVTT preserves native dialogue whitespace in ${JSON.stringify(dialogue)}`, async () => {
        const volume = Volume.fromJSON({ "/input.pjs": `10,20,"${dialogue}"\n` });
        const args = ["-v", "error", ...(forced ? ["-f", "pjs"] : []), "-i", "/input.pjs", "-f", "webvtt", sync ? "/out.vtt" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/out.vtt", "utf8") as string;
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
        assert.equal(stdout, `WEBVTT\n\n00:01.000 --> 00:02.000\n${expected}\n`);
      });
    }
  }
}
