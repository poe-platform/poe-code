import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// PCM from the native FFmpeg 7.0.2 reproduction: four 512-sample frames.
const channels = [
  Float64Array.from({ length: 2048 }, (_, i) => (i >= 1536 ? 1024 : [8192, -4096, 0, 4096][i % 4]!) / 32768),
  Float64Array.from({ length: 2048 }, (_, i) => (i >= 1536 ? 512 : -16384) / 32768)
];

for (const [filter, count, rms, start] of [
  ["astats=reset=0", 2048, -9.884384, 0],
  ["astats=reset=1", 512, -32.143934, 1536],
  ["astats=reset=2", 1024, -11.632409, 1024],
  ["astats=reset=3", 512, -32.143934, 1536],
  ["astats=reset=4", 2048, -9.884384, 0],
  ["astats=reset=2147483647", 2048, -9.884384, 0],
  ["asetnsamples=256:0,astats=reset=2", 512, -32.143934, 1536],
  ["asetnsamples=700:0,astats=reset=2", 648, undefined, 1400]
] as const) {
  it(`${filter} reports the last reset interval and preserves PCM`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
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
    const measure = (section: string, name: string) => Number(section.split(`${name}: `)[1]?.split("\n")[0]);
    const overall = stderr.split("Overall\n")[1]!;
    assert.equal(measure(overall, "Number of samples"), count);
    if (rms !== undefined) assert.ok(Math.abs(measure(overall, "RMS level dB") - rms) < 0.000001, stderr);
    for (const [index, channel] of channels.entries()) {
      const samples = channel.slice(start);
      const square = samples.reduce((sum, value) => sum + (value * 32768 / 32767) ** 2, 0);
      const peak = Math.max(...samples.map(value => Math.abs(value * 32768 / 32767)));
      const section = stderr.split(`Channel: ${index + 1}\n`)[1]!;
      assert.ok(Math.abs(measure(section, "RMS level dB") - 10 * Math.log10(square / count)) < 0.000001, stderr);
      assert.ok(Math.abs(measure(section, "Peak level dB") - 20 * Math.log10(peak)) < 0.000001, stderr);
    }
    const output = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(output.channelData.map(channel => Array.from(channel)), channels.map(channel => Array.from(channel)));
  });
}
