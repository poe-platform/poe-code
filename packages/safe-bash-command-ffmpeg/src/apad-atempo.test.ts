import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight PCM16 samples at 8 kHz become 32 output samples.
for (const graph of [false, true]) {
  for (const padding of ["", ":pad_len=8192"]) {
    for (const [tempo, options, count, seek] of [
      ["atempo=1", ["-t", "0.004"], 32, false],
      ["atempo=2", ["-t", "0.004"], 32, false],
      ["atempo=tempo=2:tempo=1", ["-t", "0.004"], 32, false],
      ["atempo", ["-to", "0.004"], 32, false],
      ["atempo=2", ["-t", "0.2"], 1600, false],
      ["atempo=8", ["-t", "0.004"], 32, false],
      ["atempo=0.5", ["-t", "0.004"], 32, false],
      ["atempo@fast=2", ["-ss", "0.01", "-to", "0.014"], 32, true]
    ] as const) {
      const filter = `apad=packet_size=64${padding},${tempo}`;
      it(`${filter} fills a duration-limited output (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(16);
        for (let i = 0; i < 8; i++) input.writeInt16LE(i + 1, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...options, "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const expected = Buffer.alloc(count * 2);
        for (let i = 0; !seek && i < 8; i++) expected.writeInt16LE(i, i * 2);
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      });
    }
  }
}
