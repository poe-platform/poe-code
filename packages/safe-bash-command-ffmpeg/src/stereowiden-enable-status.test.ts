import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 rejects malformed expressions with status 234
// before creating output. Disabling the filter preserves all input PCM.
for (const [filter, exitCode] of [
  ["stereowiden=enable=garbage", 234],
  ["stereowiden=enable=(1", 234],
  ["stereowiden=feedback=garbage", 234],
  ["stereowiden=enable=0", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} matches native status and PCM (${graph ? "graph" : "simple"})`, async () => {
      const channels = [
        Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 0 ? 10000 : 100) / 32768),
        Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 4 ? -8000 : -200) / 32768)
      ];
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }, { bitsPerSample: 16 }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (exitCode === 0) {
        const expected = Buffer.alloc(48 * 4);
        for (let i = 0; i < 48; i++) {
          expected.writeInt16LE(channels[0]![i]! * 32768, i * 4);
          expected.writeInt16LE(channels[1]![i]! * 32768, i * 4 + 2);
        }
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      } else {
        assert.equal(volume.existsSync("/out.raw"), false);
      }
      assert.equal(result.exitCode, exitCode, stderr);
    });
  }
}
