import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 2000 silent PCM16 samples followed by 400 samples at 16384.
for (const [perChannel, overall, expected] of [
  ["none", "RMS_peak", "Overall\nRMS peak dB: -8.012336\n"],
  ["none", "Peak_count", "Overall\nPeak count: 2400.000000\n"],
  ["Zero_crossings", "none", "Channel: 1\nZero crossings: 1\n"],
  ["RMS_peak", "none", "Channel: 1\nRMS peak dB: -8.012336\n"],
  ["Peak_count", "none", "Channel: 1\nPeak count: 2400\n"],
  ["none", "Number_of_samples+Max_level", "Overall\nMax level: 16384.000000\nNumber of samples: 2400\n"],
  ["RMS_peak+Peak_count+Zero_crossings", "RMS_peak+Peak_count",
    "Channel: 1\nRMS peak dB: -8.012336\nPeak count: 2400\nZero crossings: 1\nOverall\nRMS peak dB: -8.012336\nPeak count: 2400.000000\n"]
]) {
  it(`selects native astats measurements without changing PCM: ${perChannel}/${overall}`, async () => {
    const channels = [Float64Array.from({ length: 2400 }, (_, i) => i < 2000 ? 0 : 0.5)];
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })) });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-guess_layout_max", "0", "-i", "/in.wav", "-af",
        `astats=measure_perchannel=${perChannel}:measure_overall=${overall}`, "-f", "s16le", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, expected);
    const pcm = Buffer.concat(stdout);
    assert.equal(pcm.length, 4800);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), "f5cc9cb6b8345be6d8ab9db678c377dc610c2c685a07992b0dc87aca50d7a719");
  });
}
