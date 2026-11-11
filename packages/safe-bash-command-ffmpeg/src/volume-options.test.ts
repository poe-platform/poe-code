import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -29341, -1025, -5, -3, -1, 0, 1, 3, 5, 1025, 29341, 32767];
const wav = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });

async function run(option: string) {
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/in.wav", wav);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-af", `volume=0.5:${option}`, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, error: Buffer.concat(errors).toString() };
}

// FFmpeg 7 PCM16 output for the arithmetic options and their literal controls.
for (const option of [
  "precision=1+1", "eval=1+0", "replaygain_preamp=1/2", "replaygain=1+1",
  "precision=2", "replaygain_preamp=0.5", "replaygain=track",
  "precision=double+0", "eval=frame+0", "replaygain=track+0",
  "1+1:1+0:1+1:1/2"
]) {
  it(`evaluates volume ${option}`, async () => {
    const { result, fs, error } = await run(option);
    assert.equal(result.exitCode, 0, error);
    const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual, value => value * 32768),
      [-16384, -14670, -512, -2, -2, 0, 0, 0, 2, 2, 512, 14670, 16384]);
  });
}

for (const option of [
  "precision=1+2", "precision=-1/4", "eval=1+1", "replaygain=2+2",
  "replaygain_preamp=60+1", "replaygain_preamp=-60-1",
  ...["precision", "eval", "replaygain", "replaygain_preamp"].flatMap(key =>
    ["1/0", "0/0", "1+", "unknown"].map(value => `${key}=${value}`))
]) {
  it(`rejects volume ${option} without replacing output`, async () => {
    const { result, fs } = await run(option);
    assert.equal(result.exitCode, option.endsWith("=1+") || option.endsWith("=unknown") ? 234 : 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "KEEP");
  });
}
