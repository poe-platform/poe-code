import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static: stereo s16le at 8 kHz, eight sample pairs.
for (const complex of [false, true]) {
  for (const [options, valid] of [
    ["loop=2:size=2147483648", false],
    ["loop=2147483648:size=0", false],
    ["loop=0:size=3:start=9007199254740992", true],
    ["loop=0:size=2147483647", true],
    ["loop=2147483647:size=0", true],
    ["0:3:9223372036854775807", true],
    ["0:3:18446744073709551616", false],
    ["0:2147483648", false],
    ["2147483648:0", false]
  ] as const) {
    it(`aloop=${options} enforces option ranges (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(8 * 4);
      for (let i = 0; i < 8; i++) {
        input.writeInt16LE(101 + i, i * 4);
        input.writeInt16LE(-901 - i, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const filter = `aloop=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), input);
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("aloop:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
