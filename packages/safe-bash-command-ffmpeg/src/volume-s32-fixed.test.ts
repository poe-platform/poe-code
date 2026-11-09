import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-1073741824, -65537, -255, -1, 0, 1, 255, 65537, 1073741824];
// FFmpeg 7.0.2 default x86-64 optimized output; -cpuflags 0 rounds ties differently.
for (const [filter, expected] of [
  ["0.5:precision=fixed", [-536870912, -32768, -128, 0, 0, 0, 128, 32768, 536870912]],
  ["1:precision=fixed", samples],
  ["0.5:precision=float", [-536870912, -32768, -128, 0, 0, 0, 128, 32768, 536870912]]
] as const) {
  it(`matches x86 PCM32 rounding for volume=${filter}`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "keep" });
    const bytes = Buffer.alloc(samples.length * 4);
    samples.forEach((value, index) => bytes.writeInt32LE(value, index * 4));
    fs.writeFileSync("/in.raw", bytes);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s32le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `volume=${filter}`, "-c:a", "pcm_s32le", "-f", "s32le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, expected.length * 4);
    assert.deepEqual(Array.from({ length: expected.length }, (_, index) => output.readInt32LE(index * 4)), expected);
  });
}
