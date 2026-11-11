import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Status and PCM measured with FFmpeg 7.0.2-static, mono PCM16LE at 8 kHz.
for (const graph of [false, true]) {
  for (const [options, status] of [
    ["loop=1:size=-1", 222],
    ["loop=-2:size=3", 222],
    ["1:3:-2", 222],
    ["loop=1:size=2147483648", 222],
    ["loop=2147483648:size=3", 222],
    ["0:3:18446744073709551616", 222],
    ["1:3:0:bogus=1", 8],
    ["1:3:0:enable=0", 176],
    ["loop=oops", 234],
    ["1:3:0", 0]
  ] as const) {
    it(`aloop=${options} preserves native status and stdout (${graph ? "graph" : "simple"})`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.alloc(11 * 2);
      for (let i = 0; i < 11; i++) input.writeInt16LE(i + 1, i * 2);
      await fs.writeFile("/in.raw", input);
      const chunks: Buffer[] = [];
      let stderr = "";
      const filter = `aloop=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      const output = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        status === 0 ? [1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : []);
      assert.equal(result.exitCode, status, stderr);
      assert.deepEqual(Buffer.from(await fs.readFile("/in.raw")), input);
    });
  }
}
