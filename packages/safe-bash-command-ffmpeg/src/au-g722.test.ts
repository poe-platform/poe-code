import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`decodes G.722 in AU through the public command (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.au", Buffer.from("2e736e64000000200000000f0000001800001f4000000001000000000000000012345678abcdef0112345678abcdef", "hex"));
    const args = ["-y", "-v", "error", "-i", "/in.au", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
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
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, 60);
    assert.equal(createHash("sha256").update(output).digest("hex"), "ebe3615fd816af723aa75e7ef97fe952958975ca54258f8cd34cfb8c6a13a4ec");
  });
}
