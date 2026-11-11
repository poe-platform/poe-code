import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 hashes of all 8000 signed PCM16 samples, without WAV metadata.
const references = {
  highpass: [
    "928f82e4fafb8388e7e14f1333cf6792c4f99d1706e47f2846fff8df18a6ed08",
    "096d45e28d4ae82a18a4562e353e6de24eb0fea1ea03ef6e60e2feb37bfadfa9",
    "3199c382b9e2e87405954f39db24d6144b61640a2c258b3adc45794e73820e82"
  ],
  lowpass: [
    "470c4d90b8b3ba96c43db643cc7de81a0862ebc842d0a30b592fa11fdd4d8362",
    "3889f795e045c8406eabde245a490ae83641e13b18dd9ce74ae828b190b252d7",
    "fbc8c0cc50b2c9ec05e7d6d27bae42fc89120e9a877e013d5ecd3485cfe7fffb"
  ]
};
for (const [filter, hashes] of Object.entries(references)) {
  for (const [precision, hash] of [["", hashes[0]], [":precision=s16", hashes[0]],
    [":precision=f32", hashes[1]], [":precision=f64", hashes[2]]]) {
    it(`${filter}${precision} matches native sustained PCM16 samples`, async () => {
      const samples = Float64Array.from({ length: 8000 }, (_, i) =>
        (((i * 73 % 97) - 48) * 20 + (i % 40 < 20 ? 3200 : -3200)) / 32768);
      const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [samples] })) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", "-af", `${filter}=f=300${precision}`, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 16000);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
