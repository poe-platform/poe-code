import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const length of [5, 256]) {
  it(`accepts swr_flags res and preserves ${length} equal-rate PCM samples`, async () => {
    const pcm = Buffer.alloc(length * 2);
    if (length === 5) {
      for (let i = 0; i < length; i++) pcm.writeInt16LE(1000, i * 2);
    } else {
      pcm.writeInt16LE(16384, length);
    }
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
        "-ar", "8000", "-swr_flags", "res", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync("/out.pcm"), pcm);
  });
}

for (const value of ["invalid", undefined]) {
  it(`rejects swr_flags ${String(value)} before writing output`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-swr_flags", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async writeFile() { assert.fail("must not write output"); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 8);
    assert.ok(stderr.includes("swr_flags must be res"), stderr);
  });
}
