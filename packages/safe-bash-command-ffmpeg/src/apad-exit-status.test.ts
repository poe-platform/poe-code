import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 on Linux, with seven mono PCM16 samples at 1 kHz.
for (const [options, exitCode] of [
  ["pad_len=-2", 222],
  ["whole_len=3:pad_len=2", 234],
  ["pad_len=2:whole_len=3", 234],
  ["packet_size=oops:pad_len=1", 234],
  ["pad_dur=bad", 234],
  ["invalid=2", 8],
  ["pad_len=2", 0],
  ["whole_len=9", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`apad=${options} returns native status (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(14);
      [0x12345671, 0x23456783, -0x34567897, 0x42345679, -0x1234567f, 0x78123479, 0x60000001]
        .forEach((value, index) => input.writeInt16LE(value >> 16, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      let writes = 0;
      const filter = `apad=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { writes++; volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode) {
        assert.equal(writes, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([input, Buffer.alloc(4)]));
      }
    });
  }
}
