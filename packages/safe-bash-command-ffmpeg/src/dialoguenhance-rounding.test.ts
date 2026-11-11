import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const { repeats, complex } of [520, 1024, 2048].flatMap(repeats =>
  [false, true].map(complex => ({ repeats, complex })))) {
  it(`rounds the dialogue center to native PCM16 (${repeats} periods, graph=${complex})`, async () => {
    const pattern = [[8000, 4000, -16000, 0], [-2000, 12000, 3000, -9000]];
    const channels = pattern.map(samples => Float64Array.from({ length: repeats * 4 }, (_, i) => samples[i % 4]! / 32768));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 16000, channels }));
    let stderr = "";
    const filters = complex ? ["-filter_complex", "[0:a]dialoguenhance[s]", "-map", "[s]"] : ["-af", "dialoguenhance"];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...filters, "-f", "s16le", "/out.raw"],
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
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, repeats * 4 * 6);
    // FFmpeg 7.0.2 x86-64: center sample at frame 2079 is 45 03.
    assert.equal(pcm.readInt16LE(2079 * 6 + 4), 837);
    if (repeats > 520) assert.equal(pcm.readInt16LE(2636 * 6 + 4), -1305);
    for (let i = 0; i < repeats * 4; i++) {
      for (let c = 0; c < 2; c++) {
        assert.equal(pcm.readInt16LE(i * 6 + c * 2), i < 1536 ? 0 : pattern[c]![(i - 1536) % 4]);
      }
    }
  });
}
