import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [option, exitCode] of [
    ["", 0], ["threads=1", 0], ["thread_type=slice", 0], ["extra_hw_frames=1", 0],
    ["threads=1:thread_type=slice:extra_hw_frames=1", 0],
    ["threads=0:thread_type=0:extra_hw_frames=-1", 0],
    ["threads=2147483647:extra_hw_frames=2147483647", 0],
    ["threads=default:extra_hw_frames=default", 0],
    ["threads=1+1:extra_hw_frames=2-1", 0],
    ["thread_type=+slice", 0], ["thread_type=-slice", 0],
    ["thread_type=4294967295", 0],
    ["threads=-1", 222], ["threads=2147483648", 222],
    ["threads=", 234], ["threads=bogus", 234],
    ["thread_type=bogus", 234], ["thread_type=0.5", 222],
    ["thread_type=4294967296", 222],
    ["extra_hw_frames=-2", 222], ["extra_hw_frames=2147483648", 222],
    ["unknown=1", 8]
  ] as const) {
    for (const outputExists of [false, true]) {
      it(`aecho ${option || "defaults"} (${graph ? "graph" : "simple"}, output ${outputExists ? "exists" : "absent"})`, async () => {
        const samples = [1001, 0, 0, -2003, 0, 0, 0, 0, 303, 0, 0];
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input, ...(outputExists ? { "/out.raw": "KEEP" } : {}) });
        const filter = `aecho=0.7:0.8:2|5:0.31|0.62${option ? `:${option}` : ""}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        if (exitCode === 0) {
          const output = volume.readFileSync("/out.raw") as Buffer;
          // Native FFmpeg 7.0.2: all sixteen PCM16 samples, including the echo tail.
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
            [560, 0, 248, -1121, 0, 0, 0, 0, -823, 0, 75, 0, 0, 150, 0, 0]);
        } else {
          assert.ok(stderr.includes("aecho:"), stderr);
          assert.equal(volume.existsSync("/out.raw"), outputExists);
          if (outputExists) assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
