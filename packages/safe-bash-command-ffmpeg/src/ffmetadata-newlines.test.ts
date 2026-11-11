import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [input, expected] of [
  [";FFMETADATA1\na=b\\\r\nc=d\n", ";FFMETADATA1\na=b\r\nc=d\n"],
  [";FFMETADATA1\na=b\\\nc=d\n", ";FFMETADATA1\na=b\\\nc\\=d\n"],
  [";FFMETADATA1\ncomment=line one\\\nline two\n", ";FFMETADATA1\ncomment=line one\\\nline two\n"],
]) {
  for (const sync of [false, true]) {
    it(`round-trips FFmetadata escapes ${JSON.stringify(input)} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.ffmeta": input });
      const args = ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
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
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), expected);
    });
  }
}
