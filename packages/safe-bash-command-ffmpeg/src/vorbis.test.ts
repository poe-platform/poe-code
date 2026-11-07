import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { oggAst, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

it("writes requested Vorbis stream comments when encoding WAV", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wav", encodeWav({ sampleRate: 48000,
    channels: [Float64Array.from({ length: 4800 }, (_, i) => Math.sin(i * 0.1) * 0.4)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", "-metadata", "title=Review", "-metadata", "artist=Renée", "/out.ogg"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  const output = parseAudio(await fs.readFile("/out.ogg"));
  assert.equal(output.streams[0]!.codec, "vorbis");
  assert.equal(output.streams[0]!.tags?.TITLE, "Review");
  assert.equal(output.streams[0]!.tags?.ARTIST, "Renée");
  assert.equal(output.duration, 0.1);
});

for (const count of [6720, 4800, 64]) {
  const fixture = count === 6720;
  it(`decodes ${fixture ? "fixture" : `${count}-sample`} Ogg Vorbis to PCM WAV with native sample timing`, async () => {
    const fs = createMemoryFileSystem();
    const source = fixture ? readFileSync(new URL("../../safe-bash-command-audio/fixtures/tone.ogg", import.meta.url))
      : oggAst().serialize(parseWav(encodeWav({ sampleRate: 48000,
        channels: [Float64Array.from({ length: count }, (_, i) => Math.sin(i * 0.1) * 0.4)] })));
    await fs.writeFile("/in.ogg", source);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.ogg", "-vn", "-c:a", "pcm_s16le", "/out.wav"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(await fs.readFile("/out.wav")).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 48000);
    assert.equal(audio.channels, fixture ? 2 : 1);
    assert.equal(audio.channelData[0]!.length, count);
    if (!fixture) return;
    // Native FFmpeg with -cpuflags 0 converting this decoder's pcm_f32le output
    // to s16le. Using identical decoded floats isolates integer rounding from
    // platform-dependent Vorbis transform precision (including halfway values).
    const pcm = Buffer.alloc(count * audio.channels * 2);
    for (let i = 0; i < count; i++) {
      for (let channel = 0; channel < audio.channels; channel++) {
        pcm.writeInt16LE(audio.channelData[channel]![i]! * 32768, (i * audio.channels + channel) * 2);
      }
    }
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "303339b1cca791127c560a86315edbf501c95b3a71635d571b00f0132f2d0880");
    // Native FFmpeg 9.0.2, sampled from the decoded PCM16 output.
    const positions = [0, 1, 20, 100, 1000, 5000, 6719];
    const expected = [[-219, 334, 8899, -5105, 8582, -8626, 3], [-64, 486, 6602, 4608, -6751, -6562, -6]];
    for (const [channel, values] of expected.entries()) {
      for (const [index, value] of values.entries()) {
        assert.ok(Math.abs(audio.channelData[channel]![positions[index]!]! * 32768 - value) <= 1);
      }
    }
  });
}
