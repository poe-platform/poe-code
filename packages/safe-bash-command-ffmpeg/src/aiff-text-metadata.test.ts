import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`exports all four AIFF text chunks (${sync ? "sync" : "async"})`, async () => {
    const input = Buffer.from("464f524d0000007241494646434f4d4d000000120001000000040010400bfa000000000000004e414d4500000004536f6e6741555448000000064172746973742863292000000009436f7079726967687400414e4e4f00000007436f6d6d656e740053534e440000001000000000000000000064ff38012cfe70", "hex");
    const volume = Volume.fromJSON({ "/in.aiff": Buffer.from(input) });
    const args = ["-y", "-v", "error", "-i", "/in.aiff", "-bitexact", "-f", "ffmetadata", "/out.ffmeta"];
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
    const lines = String(volume.readFileSync("/out.ffmeta", "utf8")).trim().split("\n");
    assert.deepEqual(lines.sort(), [";FFMETADATA1", "title=Song", "author=Artist", "copyright=Copyright", "comment=Comment"].sort());
  });
}
