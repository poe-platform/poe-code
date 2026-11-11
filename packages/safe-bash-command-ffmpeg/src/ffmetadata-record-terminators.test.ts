import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const newline of ["\r", "\r\n", "\n"]) {
    it(`reads FFmetadata records terminated by ${JSON.stringify(newline)} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.meta": `;FFMETADATA1\na=b${newline}c=d${newline}` });
      const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      const expected = ";FFMETADATA1\na=b\nc=d\n";
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
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.equal(stdout, expected);
      }
    });
  }
}
