import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: three stereo PCM16 frames at 8 kHz.
for (const [options, limit, expected] of [
  ["whole_len=5:packet_size=2:3", ["-t", "0.001"], [101, -901, 202, -802, 303, -703, 0, 0, 0, 0]],
  ["pad_len=4:packet_size=2:3", ["-t", "0.001"], [101, -901, 202, -802, 303, -703, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["packet_size=3:pad_len=4", ["-t", "0.001"], [101, -901, 202, -802, 303, -703, 0, 0, 0, 0, 0, 0, 0, 0]],
  ["2:2:3", ["-t", "0.001"], null],
  ["pad_len=4:packet_size=2:3", ["-frames:a", "2"], [101, -901, 202, -802, 303, -703, 0, 0, 0, 0, 0, 0]],
  ["2:4", ["-frames:a", "2"], [101, -901, 202, -802, 303, -703, 0, 0, 0, 0]]
] as const) {
  for (const graph of [false, true]) {
    it(`apad=${options} resolves positional options with ${limit.join(" ")} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      const input = Buffer.alloc(12);
      [101, -901, 202, -802, 303, -703].forEach((value, index) => input.writeInt16LE(value, index * 2));
      volume.writeFileSync("/in.raw", input);
      const filter = `apad=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...limit, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("apad: pad_len and whole_len are mutually exclusive"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      }
    });
  }
}
