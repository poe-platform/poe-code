import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [options, start, end] of [
    ["start_sample=3:", 3, 24],
    ["duration=1ms:", 0, 8],
    ["end_sample=4:", 0, 4],
    ["start_sample=3", 3, 24],
    ["duration=1ms", 0, 8],
    ["end_sample=4::", -1, 0]
  ] as const) {
    it(`atrim=${options} handles trailing separators (${complex ? "complex" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 24 }, (_, i) => (i + 1) / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "KEEP" });
      let stderr = "";
      const filter = `atrim=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, start < 0 ? 234 : 0, stderr);
      if (start < 0) {
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "KEEP");
      } else {
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768),
          Array.from({ length: end - start }, (_, i) => start + i + 1));
      }
    });
  }
}
