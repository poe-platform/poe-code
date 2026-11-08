import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 default swresample PCM16 impulse responses.
for (const [inputRate, rate, length, center, tail] of [
  [16000, 8000, 256, [211, -229, 242, 7946, 242, -229, 211],
    [7946, 242, -229, 211, -186, 159, -130, 103, -77, 55, -38, 24, -14, 8, -4, 1]],
  [8000, 16000, 128, [-3349, 0, 10387, 16384, 10387, 0, -3349],
    [16384, 10387, 0, -3349, 0, 1880, 0, -1213, 0, 823, 0, -566, 0, 387, 0, -259,
      0, 169, 0, -106, 0, 63, 0, -35, 0, 18, 0, -8, 0, 3, 0, -1]],
  [8000, 8000, 128, [0, 0, 0, 16384, 0, 0, 0], [16384]]
] as const) {
  it(`matches the default PCM16 impulse response from ${inputRate} to ${rate} Hz`, async () => {
    const pcm = Buffer.alloc(length * 2);
    pcm.writeInt16LE(16384, length);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.pcm", pcm);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-f", "s16le", "-ar", String(inputRate), "-ac", "1", "-i", "/in.pcm",
        "-ar", String(rate), "-f", "s16le", "/out.pcm"],
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
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length / 2, length * rate / inputRate);
    const middle = output.length / 4;
    for (let i = 0; i < output.length / 2; i++) {
      const expected = tail[Math.abs(i - middle)] ?? 0;
      // Native PCM16 coefficient quantization can differ by one least-significant bit.
      assert.ok(Math.abs(output.readInt16LE(i * 2) - expected) <= 1, `sample ${i}`);
    }
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => output.readInt16LE((middle - 3 + i) * 2)), center);
  });
}
