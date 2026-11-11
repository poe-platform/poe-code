import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["srt", "webvtt"]) {
    for (const dialogue of ["Alpha  ", "Alpha"]) {
      it(`${sync ? "sync" : "async"} MPL2 to ${format} preserves ${JSON.stringify(dialogue)}`, async () => {
        const volume = Volume.fromJSON({ "/in.txt": `[10][20]${dialogue}\n` });
        const args = ["-v", "error", "-f", "mpl2", "-i", "/in.txt", "-f", format, sync ? "/out.txt" : "pipe:1"];
        let stdout = "";
        let stderr = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/out.txt", "utf8") as string;
        } else {
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
        }
        assert.equal(stderr, "");
        assert.equal(stdout, format === "srt"
          ? `1\n00:00:01,000 --> 00:00:02,000\n${dialogue}\n\n`
          : `WEBVTT\n\n00:01.000 --> 00:02.000\n${dialogue}\n`);
      });
    }
  }
}
