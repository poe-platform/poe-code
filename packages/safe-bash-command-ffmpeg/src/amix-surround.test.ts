import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output at 8 kHz, including dropout at sample 733.
for (const [first, second, hash, overlap, tail] of [
  [1, 6, "4779c8bcb86fbb65", [-468], [6257]],
  [6, 1, "1ff75d6e78fbe8b7", [6000, 6050, 4100, 6150, 6200, 6250], [6257, 6309, 6361, 6414, 6466, 6518]],
  [6, 6, "f7991b189f220e2b", [4000, 4100, 4200, 4300, 4400, 4500], [6257, 6309, 6361, 6414, 6466, 6518]],
  [1, 2, "92a5897409fbbfc0", [3207], [6257]]
] as const) {
  it(`mixes ${first} + ${second} channels into the first input's layout`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
    for (const [index, [channels, length, level]] of ([
      [first, 2048, 12000], [second, 733, -4000]
    ] as const).entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: Array.from({ length: channels }, (_, channel) =>
          new Float64Array(length).fill((level + channel * 100) / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        "[0:a][1:a]amix[o]", "-map", "[o]", "-f", "s16le", "/out.pcm"],
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
    assert.equal(output.length, 2048 * first * 2);
    for (const [start, end, expected] of [[0, 733, overlap], [1536, 2048, tail]] as const) {
      for (let sample = start; sample < end; sample++) {
        assert.deepEqual(Array.from({ length: first }, (_, channel) =>
          output.readInt16LE((sample * first + channel) * 2)), expected);
      }
    }
    assert.equal(createHash("sha256").update(output).digest("hex").slice(0, 16), hash);
  });
}
