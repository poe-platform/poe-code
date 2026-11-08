import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav, writeAudioMetadata } from "@poe-code/audio-ast";
import { flacAst, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Float64Array.from({ length: 7200 }, (_, i) => (i % 2 ? -12000 : 12000) / 32768);
const wav = encodeWav({ sampleRate: 8000, channels: [samples] });
const tags = { REPLAYGAIN_TRACK_GAIN: "-6.0206 dB", REPLAYGAIN_TRACK_PEAK: "1.0",
  REPLAYGAIN_ALBUM_GAIN: "-12.0412 dB", REPLAYGAIN_ALBUM_PEAK: "0.5" };

async function run(filter: string, metadata?: Record<string, string>) {
  const fs = Volume.fromJSON({ "/out.wav": "keep" });
  const input = metadata === undefined ? wav : writeAudioMetadata(flacAst().serialize(parseWav(wav)), metadata);
  const path = metadata === undefined ? "/in.wav" : "/in.flac";
  fs.writeFileSync(path, input);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", path, "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { result, fs, error: Buffer.concat(errors).toString() };
}

for (const [filter, metadata, amplitude] of [
  ["volume=replaygain=track:replaygain_preamp=3:replaygain_noclip=0", undefined, 12000],
  ["volume=2:replaygain=track", {}, 24000],
  ["volume=replaygain=ignore", tags, 12000],
  ["volume=replaygain=drop", tags, 12000],
  ["volume=2:replaygain=track", tags, 6000],
  ["volume=2:eval=frame:replaygain=track", tags, 24000],
  ["volume=replaygain=album", tags, 3000],
  ["volume=replaygain=2:replaygain_preamp=6.0206", tags, 12000],
  ["volume=replaygain=track:replaygain_preamp=20", tags, 12000],
  ["volume=replaygain=album:replaygain_preamp=20", tags, 24000],
  ["volume=replaygain=track:replaygain_preamp=12.0412:replaygain_noclip=0", tags, 24000],
  ["volume=replaygain=track", { REPLAYGAIN_ALBUM_GAIN: "-6.0206 dB" }, 6000],
  ["volume=replaygain=album", { REPLAYGAIN_TRACK_GAIN: "-6.0206 dB" }, 12000],
  ["volume=replaygain=ignore,volume=replaygain=track", tags, 6000],
  ["volume,volume=replaygain=track", tags, 12000],
  ["volume=replaygain=track,volume=replaygain=track", tags, 6000]
] as const) {
  it(`honors ${filter} ${metadata === undefined ? "without tags" : JSON.stringify(metadata)}`, async () => {
    const { result, fs, error } = await run(filter, metadata);
    assert.equal(result.exitCode, 0, error);
    const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual, value => Math.round(value * 32768)),
      Array.from(samples, value => value < 0 ? -amplitude : amplitude));
  });
}

for (const option of ["replaygain=bad", "replaygain_preamp=61", "replaygain_preamp=-61", "replaygain_preamp=NaN", "replaygain_noclip=2"]) {
  it(`rejects invalid ${option} before writing output`, async () => {
    const { result, fs } = await run(`volume=${option}`);
    assert.equal(result.exitCode, 1);
    assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
  });
}
