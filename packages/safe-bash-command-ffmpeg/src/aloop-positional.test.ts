import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static: eight stereo PCM16 sample pairs at 8 kHz.
for (const [options, repeats] of [
  ["size=3:loop=2:0", 0],
  ["size=3:loop=2:1", 1],
  ["2:size=3:1", 1],
  ["2:3:0", 2],
  ["size=3:loop=2:invalid", null],
  ["size=3:loop=2:-2", null],
  ["size=3:loop=2:unknown=1", null],
  ["2:3:0:0:0", null]
] as const) {
  for (const graph of [false, true]) {
    it(`aloop=${options} binds positional options (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(8 * 4);
      for (let i = 0; i < 8; i++) {
        input.writeInt16LE(101 + i, i * 4);
        input.writeInt16LE(-901 - i, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `aloop=${options}`;
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
      if (repeats === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("aloop:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([
          ...Array.from({ length: repeats }, () => input.subarray(0, 3 * 4)), input
        ]));
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
