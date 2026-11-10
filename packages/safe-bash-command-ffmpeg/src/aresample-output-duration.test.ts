import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(20);
for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);

// Native FFmpeg 7.0.2 emits no PCM for these short resamples, even with -t.
for (const [filter, duration, expected] of [
  ["aresample=2000", true, Buffer.alloc(0)],
  ["aresample=500", true, Buffer.alloc(0)],
  ["aresample=2000", false, Buffer.alloc(0)],
  ["aresample=500", false, Buffer.alloc(0)],
  ["anull", true, input]
] as const) {
  it(`preserves short ${filter} output ${duration ? "with" : "without"} -t`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=3:p=0,${filter}`, ...(duration ? ["-t", "0.014"] : []), "-f", "s16le", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(Buffer.concat(output), expected);
  });
}
