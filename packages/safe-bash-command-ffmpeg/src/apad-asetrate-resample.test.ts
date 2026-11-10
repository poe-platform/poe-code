import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const padding of ["", ":pad_len=2048"]) {
    for (const duration of [0.004, 0.02]) {
      it(`preserves apad${padding} through asetrate and aresample for ${duration}s (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(16);
        for (let i = 0; i < 8; i++) input.writeInt16LE(i + 1, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `apad=packet_size=64${padding},asetrate=16000,aresample=8000`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-t", String(duration), "-f", "s16le", "/out.raw"],
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
        const output = volume.readFileSync("/out.raw") as Buffer;
        // Native FFmpeg 7.0.2 waveform; the remaining duration is silence.
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          [1, 3, 5, 8, 2, -1, ...Array(duration * 8000 - 6).fill(0)]);
      });
    }
  }
}
