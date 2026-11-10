import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const validOptions = ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
  "threads=1:thread_type=slice:extra_hw_frames=1",
  "threads=0:thread_type=0:extra_hw_frames=-1",
  "threads=2147483647:extra_hw_frames=2147483647", "threads=1+1"];
const invalidOptions = ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
  "thread_type=bogus", "extra_hw_frames=-2", "extra_hw_frames=2147483648", "unknown=1"];

for (const graph of [false, true]) {
  for (const option of [...validOptions, ...invalidOptions]) {
    it(`adelay handles ${option || "defaults"} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(32);
      for (let i = 1; i <= 8; i++) {
        input.writeInt16LE(i, (i - 1) * 4);
        input.writeInt16LE(-i, (i - 1) * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `adelay=1S|3S${option ? `:${option}` : ""}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (invalidOptions.includes(option)) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(output.toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.length, 44);
        // Native FFmpeg 7.0.2 produces these eleven stereo PCM16 pairs.
        assert.deepEqual(Array.from({ length: 11 }, (_, i) => [
          output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)
        ]), [[0, 0], [1, 0], [2, 0], [3, -1], [4, -2], [5, -3],
          [6, -4], [7, -5], [8, -6], [0, -7], [0, -8]]);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
