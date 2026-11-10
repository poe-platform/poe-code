import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const bits of [16, 32] as const) {
  for (const format of ["s64", "s64p", "s32", "dbl"]) {
    for (const complex of [false, true]) {
      it(`preserves PCM${bits} WAV samples through ${format} (${complex ? "complex" : "simple"})`, async () => {
        const samples = Array.from({ length: 3173 }, (_, i) => bits === 16 ? 16003
          : [-2147483648, -2147483647, -123456789, -1, 0, 1, 123456789, 2147483647][i % 8]!);
        const expected = Buffer.alloc(samples.length * bits / 8);
        samples.forEach((sample, i) => expected.writeIntLE(sample, i * bits / 8, bits / 8));
        const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from(samples, sample => sample / 2 ** (bits - 1))]
        }, { bitsPerSample: bits }));
        const filter = `aformat=sample_fmts=${format}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.wav",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", `s${bits}le`, "/out.raw"],
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
        assert.deepEqual(output, expected);
        // Native FFmpeg 7.0.2: 3173 PCM16 samples of 16003 survive all four formats.
        if (bits === 16) assert.equal(createHash("sha256").update(output).digest("hex"),
          "a06650fabd877e358ca321039be911ad9edc05630df1fc595c47e43f708dc804");
      });
    }
  }
}
