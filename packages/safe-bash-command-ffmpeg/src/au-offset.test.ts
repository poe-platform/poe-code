import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const offset of [0, 1, 16, 23, 24, 25, 100, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff]) {
  it(`copies AU offset ${offset} without copying header bytes or clobbering output on failure`, async () => {
    const start = offset === 25 ? 25 : 24;
    const payload = Buffer.from("000101fffc1903e8", "hex");
    const input = Buffer.alloc(start + payload.length);
    [0x2e736e64, offset, payload.length, 3, 8000, 1].forEach((value, i) => input.writeUInt32BE(value, i * 4));
    payload.copy(input, start);
    const volume = Volume.fromJSON({ "/out.bin": "KEEP", "/in.au": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.au", "-c:a", "copy", "-f", "s16be", "/out.bin"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(name: string) { return volume.readFileSync(name); },
        async writeFile(name: string, bytes: Uint8Array) { volume.writeFileSync(name, bytes); },
        async stat(name: string) { return volume.statSync(name); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    const valid = (offset > 0 && offset <= input.length) || offset >= 0x80000000;
    assert.equal(result.exitCode, valid ? 0 : 1, stderr);
    assert.deepEqual(volume.readFileSync("/out.bin"), valid ? payload : Buffer.from("KEEP"));
  });
}
