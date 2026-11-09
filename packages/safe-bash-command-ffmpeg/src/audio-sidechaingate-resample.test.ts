import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 9.0.1: [0:a][1:a]sidechaingate[o], mapped to PCM16.
// Hashes cover every decoded output sample, including the attack and resampler tail.
for (const [programRate, keyRate, programValue, keyValue, keyLength, length, hash] of [
  [8000, 16000, 8000, 4000, 4096, 2048, "4a294ce4ae62513882784a1f4e7bc90aa4f2ab442c993b10edcb07f76b931bf5"],
  [16000, 8000, 4000, 8000, 2048, 4096, "5ea34df2c70d25927ee559d513c5a87dcf34606958ccad2a7e14597a3a444521"],
  [8000, 16000, 8000, 4000, 2048, 1024, "5d1b68d4712ad055b67bc74a5f93b05b6e4b4d8aae64575d643697d4b0cb04e3"]
] as const) {
  it(`sidechaingate resamples ${keyLength} control samples from ${keyRate} to ${programRate} Hz`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/program.wav", encodeWav({ sampleRate: programRate,
      channels: [new Float64Array(programRate * 0.256).fill(programValue / 32768)] }));
    fs.writeFileSync("/key.wav", encodeWav({ sampleRate: keyRate,
      channels: [new Float64Array(keyLength).fill(keyValue / 32768)] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/program.wav", "-i", "/key.wav", "-filter_complex", "[0:a][1:a]sidechaingate[o]",
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
    assert.equal(audio.channels, 1);
    assert.equal(audio.channelData[0]!.length, length);
    const pcm = Buffer.alloc(length * 2);
    audio.channelData[0]!.forEach((sample, i) => pcm.writeInt16LE(sample * 32768, i * 2));
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
