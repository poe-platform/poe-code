import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 results, with remixing performed in floating point.
for (const [first, second, expected] of [
  [[8000], [-4000, 8000], [5414]],
  [[-4000, 8000], [8000], [828, 6828]],
  [[8000], [-4000], [2000]],
  [[-30000], [30000, 30000], [6213]],
  [[2000, 4000, 6000, 8000, 10000, 12000], [-4000, -8000], [-1000, -2000, 3000, 4000, 5000, 6000]],
  [[-4000, -8000], [2000, 4000, 6000, 8000, 10000, 12000], [4657, 4364]]
] as const) {
  it(`negotiates amix layout for ${first.length} + ${second.length} channels`, async () => {
    const volume = Volume.fromJSON({});
    for (const [index, values] of [first, second].entries()) {
      volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
        channels: values.map(value => new Float64Array(2048).fill(value / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex",
        "[0:a][1:a]amix=inputs=2[o]", "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
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
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, expected.length);
    assert.equal(audio.channelMask ?? (audio.channels === 1 ? 4 : 3), expected.length === 6 ? 0x3f : expected.length === 1 ? 4 : 3);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(value => Array(2048).fill(value)));
  });
}

// Native FFmpeg 7.0.2 references include the immediate normalization at stereo EOF.
for (const sixFirst of [true, false]) {
  it(`mixes unequal stereo and six-channel WAV lengths, six-channel first=${sixFirst}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [name, channels, frames, level] of [
      ["six", 6, 29, 12000], ["stereo", 2, 13, -4000]
    ] as const) {
      volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
        channels: Array.from({ length: channels }, () => new Float64Array(frames).fill(level / 32768)) }));
    }
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", sixFirst ? "/six.wav" : "/stereo.wav",
        "-i", sixFirst ? "/stereo.wav" : "/six.wav", "-filter_complex",
        "[0:a][1:a]amix=duration=longest:dropout_transition=0", "-c:a", "pcm_s16le", "/out.wav"],
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
    const overlap = sixFirst ? [4000, 4000, 6000, 6000, 6000, 6000] : [12485, 12485];
    const tail = sixFirst ? [12000, 12000, 12000, 12000, 12000, 12000] : [28971, 28971];
    assert.equal(audio.channels, sixFirst ? 6 : 2);
    assert.equal(audio.channelData[0]!.length, 29);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      overlap.map((value, channel) => [...Array(13).fill(value), ...Array(16).fill(tail[channel])]));
  });
}
