import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM16 samples and expected right channel from native FFmpeg 7.0.2.
for (const [expression, valid] of [
  ["mono|c0=c1", true],
  ["args=mono|c0=c1", true],
  ["args=mono|c0=c0:args=mono|c0=c1", true],
  ["mono|c0=c0:args=mono|c0=c1", true],
  ["args=invalid:args=mono|c0=c1", true],
  ["args=mono|c0=c0:threads=1:args=mono|c0=c1", true],
  ["args=mono|c0=c1:thread_type=slice:extra_hw_frames=2", true],
  ["args=mono|c0=c1:args=invalid", false],
  ["args=mono|c0=c1:args=", false],
  ["args=mono|c0=c1:unknown=mono|c0=c0", false]
] as const) {
  for (const complex of [false, true]) {
    it(`parses pan args (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const samples = [1, 4, 3, -4, -3, 6, 301, 711, 12001, -31999, 30000, 30000, -30000, -30000, 32767, -32768];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const filter = `pan=${expression}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.length, 16);
        assert.deepEqual(Array.from({ length: 8 }, (_, index) => output.readInt16LE(index * 2)),
          [4, -4, 6, 711, -31999, 30000, -30000, -32768]);
      } else {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.equal(output.toString(), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
