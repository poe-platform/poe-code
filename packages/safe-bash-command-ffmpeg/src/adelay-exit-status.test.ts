import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 Linux statuses and PCM16 output for 32 stereo samples at 8 kHz.
for (const [setting, exitCode, diagnostic] of [
  ["1:all=oops", 234, "adelay: invalid all option"],
  ["-2S", 234, "adelay: invalid delay"],
  ["1:wrong=2", 8, "adelay: unsupported option wrong"],
  ["5S", 0, ""]
] as const) {
  for (const graph of [false, true]) {
    it(`adelay=${setting} returns native status and PCM through ${graph ? "filter_complex" : "af"}`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 32 }, (_, i) => (100 + i) / 32768),
        Float64Array.from({ length: 32 }, (_, i) => (-200 - i) / 32768)
      ] }));
      const filter = `adelay=${setting}`;
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = Buffer.concat(chunks);
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode !== 0) {
        assert.equal(output.length, 0);
        assert.ok(stderr.includes(diagnostic), stderr);
      } else {
        assert.equal(stderr, "");
        assert.equal(output.length, 37 * 4);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "b431d632cca559707ec09347dcddeaf4907849de7f1daee8c033eda10951e93e");
      }
    });
  }
}
