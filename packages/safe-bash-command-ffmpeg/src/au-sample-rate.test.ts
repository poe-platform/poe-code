import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const sampleRate of [0, 8000, 1000000, 0x7fffffff, 0x80000000, 0xffffffff]) {
  it(`validates AU sample rate ${sampleRate} before replacing output`, async () => {
    const start = 24;
    const payload = Buffer.from("0064ff38012cfe70", "hex");
    const input = Buffer.alloc(start + payload.length);
    [0x2e736e64, start, payload.length, 3, sampleRate, 1].forEach((value, i) => input.writeUInt32BE(value, i * 4));
    payload.copy(input, start);
    const volume = Volume.fromJSON({ "/out.bin": "keep", "/in.au": input });
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
    const valid = sampleRate > 0 && sampleRate <= 0x7fffffff;
    assert.equal(result.exitCode, valid ? 0 : 1, stderr);
    assert.deepEqual(volume.readFileSync("/out.bin"), valid ? payload : Buffer.from("keep"));
  });
}
