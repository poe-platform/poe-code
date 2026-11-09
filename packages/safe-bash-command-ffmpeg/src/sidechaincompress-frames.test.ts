import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: 8 kHz WAV frames have 512 samples; 16 kHz frames have 1024.
for (const sampleRate of [8000, 16000]) for (const stereo of [false, true]) {
  const frameSize = sampleRate === 8000 ? 512 : 1024;
  for (const [filter, start, end] of [
    ["anull", 0, 2048], ["aselect=not(n)", 0, frameSize], ["aselect=n", frameSize, 2048],
    ["aselect=not(n),volume=0.5", 0, frameSize]
  ] as const) {
    it(`sidechaincompress preserves ${sampleRate} Hz frames through ${filter} (stereo=${stereo})`, async () => {
      const volume = Volume.fromJSON({});
      const program = Float64Array.from({ length: 2300 }, (_, i) => (i + 1000) / 32768);
      volume.writeFileSync("/a.wav", encodeWav({ sampleRate, channels: stereo ? [program, program] : [program] }));
      volume.writeFileSync("/b.wav", encodeWav({ sampleRate, channels: [new Float64Array(2048)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
          `[0:a][1:a]sidechaincompress,${filter}[o]`, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.channels, stereo ? 2 : 1);
      for (const channel of audio.channelData) {
        assert.equal(channel.length, end - start);
        for (let i = 0; i < channel.length; i++) {
          assert.ok(Math.abs(channel[i]! * 32768 - (start + i + 1000) * (filter.includes("volume") ? 0.5 : 1)) <= 0.5);
        }
      }
    });
  }
}

it("sidechaincompress splits unequal input frames, clips EOF, and resets timestamps", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(2300).fill(0.125)] }));
  volume.writeFileSync("/b.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(2048)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-itsoffset", "1", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      "[0:a]asetnsamples=n=300:p=0[a];[a][1:a]sidechaincompress,ashowinfo[o]",
      "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
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
  // Native FFmpeg drains the shorter buffered frame, retaining the other input's remainder.
  const counts = [300, 212, 88, 300, 124, 176, 300, 36, 264, 248];
  const reported = stderr.split("\n").filter(line => line.includes("nb_samples:"));
  assert.equal(reported.length, counts.length);
  let pts = 0;
  for (const [index, count] of counts.entries()) {
    assert.ok(reported[index]!.includes(`n:${index} pts:${pts} pts_time:${pts / 8000} `), reported[index]);
    assert.ok(reported[index]!.includes(`nb_samples:${count} `), reported[index]);
    pts += count;
  }
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(Array.from(audio.channelData[0]!), Array<number>(2048).fill(0.125));
});
