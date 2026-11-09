import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import { acrossfadeAudio } from "./audio-acrossfade.js";

it("acrossfade retains fractional samples for floating-point audio", async () => {
  const track = parseWav(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from([1, 3, 5, 7], value => value / 32768)] })).tracks[0]!;
  const floating = { ...track, codecDescriptions: track.codecDescriptions.map(codec =>
    ({ ...codec, codecName: "pcm_f64le" })) };
  const result = await acrossfadeAudio(floating, floating, "acrossfade=ns=4", new MediaBudgetTracker());
  assert.deepEqual(Array.from(result.decodedAudio!.channelData[0]!, value => value * 32768),
    [0.75, 2.25, 3.75, 5.25]);
});

// Signed PCM references captured from native FFmpeg's triangular crossfade.
for (const [options, expected] of [
  ["ns=4", [32767, -32768, 9038, -9038, 9258, -9536, -6153, 17592, -77, 99, 32767, -32768]],
  ["ns=4:o=0", [32767, -32768, 9038, -9038, 9258, -11728, 19, 0, 0, 2191, -6172, 17592, -77, 99, 32767, -32768]],
  ["ns=1", [32767, -32768, 9038, -9038, 12345, -23456, 77, 0, 8765, -12345, 23456, -77, 99, 32767, -32768]],
  ["ns=1:o=0", [32767, -32768, 9038, -9038, 12345, -23456, 77, 0, 0, 8765, -12345, 23456, -77, 99, 32767, -32768]]
] as const) {
  for (const channels of [1, 2]) it(`acrossfade matches native signed PCM16 samples (${options}, ${channels} channels)`, async () => {
    const volume = Volume.fromJSON({});
    const inputs = [[32767, -32768, 9038, -9038, 12345, -23456, 77, -99],
      [-2345, 8765, -12345, 23456, -77, 99, 32767, -32768]];
    for (const [index, samples] of inputs.entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: Array.from({ length: channels }, () => Float64Array.from(samples, value => value / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/0.wav", "-i", "/1.wav", "-filter_complex", `[0:a][1:a]acrossfade=${options}[mix]`,
        "-map", "[mix]", "-c:a", "pcm_s16le", "/out.wav"],
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
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, channels);
    for (const channel of audio.channelData) {
      assert.deepEqual(Array.from(channel, value => value * 32768), expected);
    }
  });
}
