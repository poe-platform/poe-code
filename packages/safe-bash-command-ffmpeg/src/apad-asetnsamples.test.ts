import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Exact PCM results from native FFmpeg 7 for an eight-sample mono input.
const input = Buffer.alloc(16);
for (let i = 0; i < 8; i++) input.writeInt16LE(101 + i, i * 2);

for (const graph of [false, true]) {
  for (const [filter, frames, samples] of [
    ["apad=packet_size=2,asetnsamples=n=12:p=0", 1, 12],
    ["apad=packet_size=2,asetnsamples=n=8:p=0", 5, 40],
    ["apad=packet_size=2,asetnsamples=n=2^3:p=0", 5, 40],
    ["apad=packet_size=2,asetnsamples=n=8.5:p=0", 5, 40],
    ["apad=packet_size=2:pad_len=128,asetnsamples=n=12:p=0", 1, 12],
    ["apad=packet_size=2", 1, 8],
    ["apad=packet_size=2,asetnsamples=n=12:p=0", 0, 0],
    ["apad=packet_size=2,asetnsamples=n=3:p=0", 2, 6],
    ["apad=packet_size=2,asetnsamples=n=12:p=1", 2, 24],
    ["apad=packet_size=2,asetnsamples@frames=nb_out_samples=12:pad=0", 1, 12],
    ["apad=packet_size=2,asetnsamples=12:0", 1, 12],
    ["apad=packet_size=2,asetnsamples", 1, 1024],
    ["apad=packet_size=2:pad_len=0,asetnsamples=n=12:p=0", 1, 8],
    ["apad=packet_size=2,asetnsamples=n=8001:p=0", 1, undefined],
    ["apad=packet_size=2,asetnsamples=n=12:p=0", 1000000, undefined],
    ["apad=packet_size=2,asetnsamples=n=0:p=0", 1, undefined]
  ] as const) {
    it(`${filter} emits ${frames} output frames (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 1 } }).execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-frames:a", String(frames), "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (samples === undefined) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc(samples * 2);
      input.copy(expected);
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    });
  }
}
