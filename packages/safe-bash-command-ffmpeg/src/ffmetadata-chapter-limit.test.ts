import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 rounds the output limit to chapter ticks before clipping.
for (const sync of [false, true]) {
  for (const option of ["-t", "-to"]) {
    for (const [limit, end] of [
      ["0.049", undefined], ["0.099", 1], ["0.1", 1],
      ["0.149", 1], ["0.15", 2], ["0.151", 2], ["1", 6]
    ] as const) {
      it(`clips FFmetadata chapters at ${option} ${limit} in chapter ticks (${sync ? "sync" : "async"})`, async () => {
        const header = ";FFMETADATA1\n";
        const chapter = "[CHAPTER]\nTIMEBASE=1/10\nSTART=1\n";
        const volume = Volume.fromJSON({ "/in.meta": `${header}${chapter}END=6\ntitle=A\n` });
        const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta",
          option, limit, "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/out.meta", "utf8") as string;
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: { async readFile(path: string) { return volume.readFileSync(path); } },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(stdout, header + (end === undefined ? "" : `${chapter}END=${end}\ntitle=A\n`));
      });
    }
  }
}
