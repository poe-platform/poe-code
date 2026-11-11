import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: output cuts select samples from the complete resample.
const head = "64008400c80003012c0159019001c601f401";
const tail = "f023212454248724b824e8241c25532580259225";
for (const [options, expected] of [
  [["-ar", "2000", "-t", "0.0045"], head],
  [["-t", "0.0045", "-ar", "2000"], head],
  [["-ar", "2000", "-to", "0.0045"], head],
  [["-ar", "2000", "-ss", "0.091"], tail],
  [["-ar", "2000", "-ss", "0.091", "-frames:a", "1"], tail],
  [["-ar", "2000", "-ss", "0.091", "-t", "0.002"], "f023212454248724"],
  [["-ar", "2000", "-ss", "0.091", "-to", "0.093"], "f023212454248724"],
  [["-ar", "2000", "-ss", "0.2"], ""],
  [["-af", "asetnsamples=n=3:p=0", "-ar", "2000", "-ss", "0.091"], tail],
  [["-ar", "2000", "-filter_size", "0", "-t", "0.0045"], "64000000c80000002c01000090010000f401"],
  [["-af", "aresample=2000", "-ss", "0.091"], tail],
  [["-af", "aresample=2000", "-t", "0.0045"], head],
  [["-ar", "500", "-t", "0.004"], "85002601"],
  [["-t", "0.0045"], "6400c8002c019001f401"],
  [["-ar", "2000"], undefined]
] as const) {
  it(`preserves resampled PCM with ${options.join(" ")}`, async () => {
    const input = encodeWav({ sampleRate: 1000,
      channels: [Float64Array.from({ length: 96 }, (_, i) => (i + 1) * 100 / 32768)] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...options, "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const pcm = Buffer.concat(output);
    if (expected === undefined) {
      assert.equal(pcm.length, 384);
      assert.equal(createHash("sha256").update(pcm).digest("hex"),
        "cde0e454ebfa30d985925edb4ba1a5e1d1e5ed948cd1e940dc9bc9145fcbd1ba");
    } else {
      assert.equal(pcm.toString("hex"), expected);
    }
  });
}
