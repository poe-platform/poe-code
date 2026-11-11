import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`preserves chapter FFmetadata tags without inventing titles (${sync ? "sync" : "async"})`, async () => {
    const input = ";FFMETADATA1\nartist=Global\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=250\nartist=Alice\n";
    const volume = Volume.fromJSON({ "/in.ffmeta": input });
    const args = ["-y", "-bitexact", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", "-f", "ffmetadata", "/out.ffmeta"];
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
    assert.equal(volume.readFileSync("/out.ffmeta", "utf8"), input);
  });
}
