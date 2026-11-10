import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: missing timestamps mute fade-in and preserve fade-out PCM32.
for (const [filter, silent] of [
  ["asetpts=NAN,afade=t=in:ss=1030:ns=627:c=tri", true],
  ["asetpts=NAN,afade=t=out:ss=1030:ns=627:c=tri", false],
  ["asetpts=NAN", false],
  ["anull", false]
] as const) {
  for (const complex of [false, true]) it(`${filter} preserves native PCM32 bytes (${complex ? "complex" : "simple"})`, async () => {
    const samples = Int32Array.from({ length: 3173 }, (_, i) => ((i * 179 % 50001) - 25000) * 65536 + i);
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(samples, sample => sample / 2147483648)]
    }, { bitsPerSample: 32 }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav",
        ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s32le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, samples.length * 4);
    assert.equal(createHash("sha256").update(output).digest("hex"), silent
      ? "bd91683a2a2610da0d63ee6c1036daaafd5f4bf299ea8713a901689e219604e8"
      : "56883ba9d1e28c079b625f637e3b4bab2430bfadf6ed2236cb1ca701653886f7");
  });
}
