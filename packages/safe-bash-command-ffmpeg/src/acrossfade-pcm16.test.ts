import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

for (const reverse of [false, true]) {
  for (const fade of ["ns=4", "d=0.0005"]) {
    it(`acrossfade resamples mixed rates before ${fade}, reverse=${reverse}`, async () => {
      const volume = Volume.fromJSON({});
      for (const [name, rate, length, value] of [
        ["a", 8000, 1000, 12000], ["b", 16000, 2000, -4000]
      ] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: rate,
          channels: [new Float64Array(length).fill(value / 32768)] }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", reverse ? "/b.wav" : "/a.wav", "-i", reverse ? "/a.wav" : "/b.wav",
          "-filter_complex", `[0:a][1:a]acrossfade=${fade}[o]`, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
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
      const length = reverse ? 2000 : 1000;
      const count = reverse && fade.startsWith("d=") ? 8 : 4;
      const first = reverse ? -4000 : 12000;
      const second = reverse ? 12000 : -4000;
      assert.equal(audio.sampleRate, reverse ? 16000 : 8000);
      assert.equal(audio.channels, 1);
      assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768), [
        ...Array<number>(length - count).fill(first),
        ...Array.from({ length: count }, (_, i) => Math.trunc(first * (count - 1 - i) / count + second * i / count)),
        ...Array<number>(length - count).fill(second)
      ]);
    });
  }
}

it("acrossfade bounds rate conversion before allocating the second input", async () => {
  const first = parseWav(encodeWav({ sampleRate: 16000,
    channels: [new Float64Array(64)] })).tracks[0]!;
  const second = parseWav(encodeWav({ sampleRate: 8000,
    channels: [new Float64Array(128)] })).tracks[0]!;
  await assert.rejects(acrossfadeAudio(first, second, "acrossfade=ns=4",
    new MediaBudgetTracker({ maxSamplesPerTrack: 128 })), /maxSamplesPerTrack/);
});

// Native FFmpeg 7.0.2: the transition starts at sample 145; the prefix must
// retain resampler rounding rather than the fade's truncating integer cast.
for (const resampler of ["aresample=16000", "aresample=16000:osf=s16"]) {
  it(`acrossfade preserves PCM16 from ${resampler}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [name, length, gain] of [["a", 75, 101], ["b", 97, -203]] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length }, (_, i) => gain * (i + 1) / 32768)] }));
    }
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
        `[0:a]${resampler}[a];[a][1:a]acrossfade=ns=5[out]`, "-map", "[out]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(chunks);
    assert.equal(pcm.length / 2, 339);
    assert.equal(createHash("sha256").update(pcm).digest("hex"),
      "651d8f27decb59a2252d0b60c758e5fd6455edb5a544679e4d7dbb14d27b10dc");
  });
}
