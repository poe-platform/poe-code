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

for (const sync of [false, true]) {
  it(`encodes G.722 in AU through the public command (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({});
    const source = Buffer.alloc(1024);
    for (let i = 0; i < 512; i++) source.writeInt16LE((i * 2003 % 50000) - 25000, i * 2);
    volume.writeFileSync("/source.raw", source);
    volume.writeFileSync("/out.au", "keep");
    const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "/source.raw", "-c:a", "g722", "-b:a", "64000", "-f", "au", "/out.au"];
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
    const output = volume.readFileSync("/out.au") as Buffer;
    assert.equal(output.length, 288);
    assert.equal(createHash("sha256").update(output).digest("hex"), "b73f7ae64ac0a9d4f67b1ad7a6a01fe7a68ba8e77fb57f24a26947b4fe018102");
  });
}
