import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: twelve mono PCM16 samples, 1 kHz to 2 kHz.
for (const size of [0, 1, 2]) {
  for (const mode of ["packets", "first", "full"] as const) {
    if (size === 2 && mode === "full") continue;
    it(`preserves aresample filter_size=${size} ${mode} output`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          "-af", `asetnsamples=3:0,aresample=2000:filter_size=${size}`,
          ...(mode === "first" ? ["-frames:a", "1"] : []),
          "-f", mode === "packets" ? "framecrc" : "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(chunks);
      if (mode === "packets") {
        const packets = output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
          .map(line => line.split(",").map(Number)).map(row => [row[2], row[3]]);
        assert.deepEqual(packets, size < 2 ? [[0, 6], [6, 6], [12, 6], [18, 6]]
          : [[0, 4], [4, 6], [10, 6], [16, 6], [22, 2]]);
      } else {
        const samples = Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
        const full = Array.from({ length: 12 }, (_, i) => [i + 1, 0]).flat();
        assert.deepEqual(samples, mode === "full" ? full : size < 2 ? [1, 0, 2, 0, 3, 0] : [1, 1, 2, 1]);
      }
    });
  }
}
