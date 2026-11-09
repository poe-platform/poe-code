import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const unknownLength of [false, true]) {
  const bytes = Buffer.alloc(1050);
  [0x2e736e64, 24, unknownLength ? 0xffffffff : 1026, 3, 8000, 1]
    .forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
  for (let index = 0; index < 513; index++) bytes.writeInt16BE(index - 256, 24 + index * 2);

  for (const target of ["pipe:0", "/input.au"]) {
    for (const sync of [false, true]) {
      it(`decodes all AU samples (${unknownLength ? "unknown" : "known"}, ${target}, ${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({ "/input.au": bytes });
        const args = ["-y", "-v", "error", "-i", target, "-f", "s16be", "/out.pcm"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(bytes, args,
            path => volume.readFileSync(path) as Buffer,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        } else {
          let diagnostic = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () { yield bytes; })(), stdout: { async write() {} },
            stderr: { async write(chunk: Uint8Array) { diagnostic += new TextDecoder().decode(chunk); } }
          } as never);
          assert.equal(result.exitCode, 0, diagnostic);
        }
        assert.deepEqual(volume.readFileSync("/out.pcm"), bytes.subarray(24));
      });
    }
  }
}
