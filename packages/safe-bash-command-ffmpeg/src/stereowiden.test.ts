import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [filter, impulses, sampleRate = 44100] of [
    ["stereowiden=delay=5:feedback=0.3:crossfeed=0.3:drymix=0.8", [[0, 9600, -3600], [220, 0, -3600], [2048, 2400, -6400], [2268, 2400, 0]]],
    ["stereowiden=5:0.3:0.3:0.8", [[0, 9600, -3600], [220, 0, -3600], [2048, 2400, -6400], [2268, 2400, 0]]],
    ["stereowiden=feedback=0:crossfeed=0:drymix=1", [[0, 12000, 0], [2048, 0, -8000]]],
    ["stereowiden", [[0, 9600, -3600], [882, 0, -3600], [2048, 2400, -6400], [2930, 2400, 0]]],
    // Native FFmpeg 7.0.2: nearest sample, with exact halves rounding to even.
    ...[
      [8000, 1.099, 9],
      [8000, 1.0625, 8],
      [8000, 1.1875, 10],
      [8000, 1.3125, 10],
      [8000, 1.4375, 12],
      [8000, 1.125, 9],
      [44100, 1.125, 50],
      [44100, 5, 220],
      [44100, 1.0317460317460319, 46],
      [48000, 1.0520833333333333, 50]
    ].map(([rate, delay, frames]) => [
      `stereowiden=delay=${delay}:feedback=0.5:crossfeed=0:drymix=0`,
      [[frames!, 0, -6000], [2048 + frames!, 4000, 0]],
      rate!
    ] as const),
    ...["delay=0", "delay=101", "feedback=-1", "feedback=1", "crossfeed=2", "drymix=-1", "delay=NaN", "unknown=1"].map(option => [`stereowiden=${option}`, undefined] as const)
  ] as const) {
    it(`stereowiden ${complex ? "graph" : "simple"}: ${filter} at ${sampleRate} Hz`, async () => {
      const channels = [new Float64Array(8192), new Float64Array(8192)];
      channels[0]![0] = 12000 / 32768;
      channels[1]![2048] = -8000 / 32768;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate, channels }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (!impulses) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.wav"), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, sampleRate);
      const expected = [new Array<number>(8192).fill(0), new Array<number>(8192).fill(0)];
      for (const [frame, left, right] of impulses) {
        expected[0]![frame!] = left!;
        expected[1]![frame!] = right!;
      }
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
    });
  }
}
