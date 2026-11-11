import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(noise: string) {
  const samples = new Float64Array(4000).fill(1024 / 32768);
  samples.set([32767, 16384, 16384, 8192, 8192, 8192, 8192].map(value => value / 32768));
  const input = encodeWav({ sampleRate: 8000, channels: [samples] });
  const fs = Volume.fromJSON({ "/out.wav": "KEEP" });
  fs.writeFileSync("/input.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/input.wav",
      "-af", `silencedetect=${noise}:d=0.125`, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, input, output: fs.readFileSync("/out.wav") as Buffer };
}

for (const noise of ["n=1/25", "noise=1/25", "1/25", "n=0.02*2", "n=sqrt(0.0016)",
  "n=40m", "n=-20dB*0.4", "n=0.04", "n=-28dB"]) {
  it(`silencedetect evaluates ${noise} and preserves PCM`, async () => {
    const { result, stderr, input, output } = await run(noise);
    assert.equal(result.exitCode, 0, stderr);
    // Native FFmpeg 7.0.2 intervals for this 8 kHz mono PCM fixture.
    assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), [
      "silence_start: 0.000875",
      "silence_end: 0.5 | silence_duration: 0.499125"
    ]);
    assert.deepEqual(parseWav(output).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData);
  });
}

for (const noise of ["malformed", "1/", "1/0", "0/0", "-1/25", ""]) {
  it(`silencedetect rejects n=${noise} without replacing output`, async () => {
    const { result, stderr, output } = await run(`n=${noise}`);
    assert.equal(result.exitCode, ["1/0", "-1/25"].includes(noise) ? 222 : 234, stderr);
    assert.ok(stderr.includes("silencedetect:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}
