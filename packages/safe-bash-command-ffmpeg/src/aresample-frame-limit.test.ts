import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM captured from native FFmpeg 7.0.2 for the same finite 74-sample input.
const upsampled = [1000, 1336, 2000, 2536, 3000, 3540, 4000, 4390, 5000, 5691,
  6000, 6202, 7000, 7958, 8000, 7759, 9000, 10925, 10000, 5093, 0, -1386,
  0, 732, 0, -461, 0, 310, 0, -213, 0, 146, 0, -99, 0, 65, 0, -42,
  0, 25, 0, -15, 0, 8, 0, -4, 0, 1, 0, -1, 0, 0];
for (const [rate, options, expected] of [
  [2000, ["-frames:a", "0"], []],
  [2000, ["-frames:a", "1"], upsampled.slice(0, 34)],
  [2000, ["-frames:a", "4"], upsampled],
  [2000, ["-frames:a", "100"], [...upsampled, ...Array<number>(96).fill(0)]],
  [500, ["-frames:a", "2"], [1438, 2818, 5212, 6660, 9695, 2657, -777, 436,
    -288, 201, -142, 100, -69, 45, -29, 17, -10, 5, -2, 1]],
  [1000, ["-frames:a", "4"], [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 0, 0]],
  [2000, ["-t", "0.014"], upsampled.slice(0, 28)]
] as const) {
  it(`aresample=${rate} ${options.join(" ")} matches native PCM`, async () => {
    const input = Buffer.alloc(74 * 2);
    for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=3:p=0,aresample=${rate}`, ...options, "-f", "s16le", "-"],
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
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
