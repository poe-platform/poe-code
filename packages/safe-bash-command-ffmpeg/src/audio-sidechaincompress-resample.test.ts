import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes cover every sample around stepped detector levels.
for (const [programRate, keyRate, programLength, keyLength, stereo, length, hash] of [
  [8000, 8000, 2048, 2048, false, 2048, "2d53637aa4cf6e630e5852f74acb6e5a2c58bcf7f1f38c19dcfd9c9b049d4b2f"],
  [8000, 16000, 2048, 4096, false, 2048, "7a6efb324aadd464651a79ee2288c0f1ec92791c49811161a06dc0c15ddcec14"],
  [16000, 8000, 4096, 2048, true, 4096, "382fe48d0eeb1bae9dc3e519adc47f09a49a5a354a218d422698819dbe45e04f"],
  [8000, 16000, 2048, 2048, false, 1024, "b7a396eb3dbbd492d5b4556e97575b04ff8bb9f93fa59577715ee4c8ba42ad55"],
  [8000, 16000, 1024, 4096, false, 1024, "0af567926fa7e58cd087138b0f6a421f0784b9fe509d0ad3591fdf2fdc98bf60"]
] as const) {
  it(`sidechaincompress resamples ${keyLength} samples at ${keyRate} Hz for ${programLength} samples at ${programRate} Hz`, async () => {
    const fs = Volume.fromJSON({});
    const program = new Float64Array(programLength).fill(8000 / 32768);
    const key = Float64Array.from({ length: keyLength }, (_, i) =>
      [500, 16000, 4000, 28000][Math.floor(i * 8000 / keyRate / 512)]! / 32768);
    fs.writeFileSync("/program.wav", encodeWav({ sampleRate: programRate,
      channels: stereo ? [program, program.map(value => -value / 2)] : [program] }));
    fs.writeFileSync("/key.wav", encodeWav({ sampleRate: keyRate, channels: [key] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/program.wav", "-i", "/key.wav", "-filter_complex", "[0:a][1:a]sidechaincompress[o]",
        "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, programRate);
    assert.equal(audio.channels, stereo ? 2 : 1);
    const pcm = Buffer.alloc(length * audio.channels * 2);
    for (const [channel, samples] of audio.channelData.entries()) {
      assert.equal(samples.length, length);
      samples.forEach((sample, i) => pcm.writeInt16LE(sample * 32768, (i * audio.channels + channel) * 2));
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

it("sidechaincompress bounds the resampled detector before replacing output", async () => {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  fs.writeFileSync("/program.wav", encodeWav({ sampleRate: 16000, channels: [new Float64Array(64)] }));
  fs.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(128)] }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxSamplesPerTrack: 128 } }).execute({
    args: ["-y", "-i", "/program.wav", "-i", "/key.wav", "-filter_complex", "[0:a][1:a]sidechaincompress[o]",
      "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 1);
  assert.ok(stderr.includes("maxSamplesPerTrack"), stderr);
  assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
});
