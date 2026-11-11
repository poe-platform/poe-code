import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const option of ["-t", "-to"]) {
    for (const end of [1499, 1500, 1501]) {
      it(`clips chapters at ${option} ${end / 1000} (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({
          "/a.meta": ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=2000\ntitle=Intro\n"
        });
        const args = ["-v", "error", ...(sync ? ["-y", "-f", "ffmetadata"] : []), "-i", "/a.meta", option, String(end / 1000),
          "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
        const expected = ";FFMETADATA1\n" + (end < 1500 ? "" :
          `[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=${end}\ntitle=Intro\n`);
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          assert.equal(volume.readFileSync("/out.meta", "utf8"), expected);
        } else {
          let stdout = "";
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
          assert.equal(result.exitCode, 0);
          assert.equal(stderr, "");
          assert.equal(stdout, expected);
        }
      });
    }
  }
}
