import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, status] of [
  ["", 0], [":threads=1", 0], [":thread_type=slice", 0], [":extra_hw_frames=1", 0],
  [":threads=1:thread_type=slice:extra_hw_frames=1", 0],
  [":threads=0:thread_type=0:extra_hw_frames=-1", 0],
  [":threads=2147483647:extra_hw_frames=2147483647", 0],
  [":threads=1+1:extra_hw_frames=2-1", 0],
  [":threads=default", 0], [":threads=min", 0],
  [":thread_type=none", 0], [":thread_type=all", 0],
  [":extra_hw_frames=min", 0], [":extra_hw_frames=default", 0],
  [":threads=default+1:extra_hw_frames=min+1:thread_type=+slice", 0],
  [":threads=min-1", 222], [":extra_hw_frames=default-1", 222],
  [":threads=none", 0], [":extra_hw_frames=all", 0],
  [":extra_hw_frames=none", 0], [":threads=all+1:extra_hw_frames=none-1", 0],
  [":threads=all", 222], [":threads=none-1", 222], [":extra_hw_frames=all-1", 222],
  [":extra_hw_frames=slice", 234],
  [":thread_type=+slice", 0], [":thread_type=-slice", 0],
  [":thread_type=4294967295", 0],
  [":threads=-1", 222], [":threads=2147483648", 222],
  [":extra_hw_frames=-2", 222], [":extra_hw_frames=2147483648", 222],
  [":threads=", 234], [":threads=0/0", 234],
  [":thread_type=bogus", 234], [":thread_type=", 234],
  [":thread_type=0.5", 222], [":thread_type=4294967296", 222],
  [":unknown=1", 8]
] as const) {
  for (const graph of [false, true]) {
    for (const outputExists of [false, true]) {
      for (const padding of [0, 4]) {
        it(`apad pad_len=${padding} generic options ${options || "control"} (${graph ? "graph" : "simple"}, output ${outputExists ? "exists" : "absent"})`, async () => {
          const input = Buffer.alloc(16);
          for (let i = 0; i < 8; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
          const volume = Volume.fromJSON({ "/in.raw": input,
            ...(outputExists ? { "/out.raw": "KEEP" } : {}) });
          const filter = `apad=pad_len=${padding}${options}`;
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-t", "0.016", "-f", "s16le", "/out.raw"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, status, stderr);
          if (status === 0) {
            const output = volume.readFileSync("/out.raw") as Buffer;
            // FFmpeg 7.0.2 preserves the input and appends the requested silence.
            assert.equal(output.length, 16 + padding * 2);
            assert.deepEqual(Array.from({ length: 8 + padding }, (_, i) => output.readInt16LE(i * 2)),
              [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, ...Array<number>(padding).fill(0)]);
          } else {
            assert.ok(stderr.includes("apad:"), stderr);
            assert.equal(volume.existsSync("/out.raw"), outputExists);
            if (outputExists) assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
          }
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
        });
      }
    }
  }
}

for (const setting of ["threads=0", "threads=none", "extra_hw_frames=-1", "extra_hw_frames=all"]) {
  for (const graph of [false, true]) {
    it(`apad ${setting} matches native PCM on stdout (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.pcm": Buffer.from("6400c8002c019001f4015802bc022003", "hex") });
      const filter = `apad=pad_len=3:${setting}`;
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-t", "0.008", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      // FFmpeg 7.0.2: eight input samples followed by three silent samples.
      assert.equal(Buffer.concat(output).toString("hex"), "6400c8002c019001f4015802bc022003000000000000");
    });
  }
}
