import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: resample the complete impulse before discarding output samples.
for (const [rate, firstPts, length, prefix] of [
  [4000, 128, 192, [11640, 354, -336, 308, -273, 233]],
  [4000, 129, 192, [11640, 354, -336, 308, -273, 233]],
  [4000, 131, 191, [354, -336, 308, -273, 233, -191]],
  [16000, 129, 766, [0, -4906, 0, 2753, 0, -1778]],
  [11025, 129, 529, [17133, -3118, -1331, 2449, -1658, 282]],
  [4000, 512, 0, []],
  [11025, 512, 1, [0]]
] as const) {
  for (const graph of [false, true]) {
    for (const channelCount of [1, 2]) {
      it(`preserves the impulse at first_pts=${firstPts}, ${rate} Hz (${channelCount} channels, ${graph ? "graph" : "simple"})`, async () => {
        const channels = Array.from({ length: channelCount }, () => {
          const samples = new Float64Array(512);
          samples[128] = 24000 / 32768;
          return samples;
        });
        const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
        async function convert(filter: string, outputRate?: number) {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
              ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              ...(outputRate === undefined ? [] : ["-ar", String(outputRate)]), "-f", "s16le", "/out.pcm"],
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
          return volume.readFileSync("/out.pcm") as Buffer;
        }
        const actual = await convert(`aresample=${rate}:first_pts=${firstPts}`);
        assert.equal(actual.length, length * channelCount * 2);
        for (let channel = 0; channel < channelCount; channel++) {
          prefix.forEach((sample, i) => assert.equal(actual.readInt16LE((i * channelCount + channel) * 2), sample));
        }
        const trimmed = await convert(`aresample=${rate},atrim=start_sample=${Math.floor(firstPts * rate / 8000)}`);
        assert.deepEqual(actual, trimmed);
        assert.deepEqual(await convert(`aresample=first_pts=${firstPts}`, rate), actual);
        const nextPts = Math.round(firstPts * rate / 8000) + 1;
        assert.deepEqual(await convert(`aresample=${rate}:first_pts=${firstPts},atrim=start_pts=${nextPts}`),
          actual.subarray(channelCount * 2));
        if (rate === 4000 && firstPts === 129 && channelCount === 1) {
          assert.equal(createHash("sha256").update(actual).digest("hex").slice(0, 16), "997cf405157c6c65");
        }
      });
    }
  }
}
