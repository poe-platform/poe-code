import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: three stereo PCM16 frames at 8 kHz.
for (const [options, expected] of [
  ["1S:all=1:2S", [0, 0, 0, 0, 101, -901, 202, -802, 303, -703]],
  ["1S:enable=1:2S", [0, -901, 0, -802, 101, -703, 202, 0, 303, 0]],
  ["1S:enable=0:2S", [101, -901, 202, -802, 303, -703, 0, 0, 0, 0]],
  ["1S:1:2S", null],
  ["delays=1S:1", [0, 0, 101, -901, 202, -802, 303, -703]],
  ["1S:1", [0, 0, 101, -901, 202, -802, 303, -703]]
] as const) {
  for (const graph of [false, true]) {
    it(`adelay=${options} resolves positional options (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "keep" });
      const input = Buffer.alloc(12);
      [101, -901, 202, -802, 303, -703].forEach((value, index) => input.writeInt16LE(value, index * 2));
      volume.writeFileSync("/in.raw", input);
      const filter = `adelay=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
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
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("adelay: unsupported option"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      }
    });
  }
}
