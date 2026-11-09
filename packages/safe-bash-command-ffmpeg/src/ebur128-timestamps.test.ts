import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: -hide_banner -nostats -y -v info -i in.wav
// -af ebur128=peak=sample -c:a pcm_s16le out.wav
const cases = [
  { sampleRate: 8000, timestamps: [
    "0.099875", "0.199875", "0.299875", "0.399875", "0.499875",
    "0.599875", "0.699875", "0.799875", "0.899875", "0.999875",
    "1.099875", "1.199875", "1.299875", "1.399875", "1.499875",
    "1.599875", "1.699875", "1.799875", "1.899875", "1.999875",
    "2.099875", "2.199875", "2.299875", "2.399875", "2.499875",
    "2.599875", "2.699875", "2.799875", "2.899875", "2.999875",
    "3.099875", "3.199875", "3.299875", "3.399875", "3.499875"
  ] },
  { sampleRate: 44100, timestamps: [
    "0.0999773", "0.199977", "0.299977", "0.399977", "0.499977", "0.599977",
    "0.699977", "0.799977", "0.899977", "0.999977", "1.099977", "1.199977"
  ] },
  { sampleRate: 48000, timestamps: [
    "0.0999792", "0.199979", "0.299979", "0.399979", "0.499979", "0.599979",
    "0.699979", "0.799979", "0.899979", "0.999979", "1.099979", "1.199979"
  ] },
  { sampleRate: 1000, timestamps: [
    "0.099", "0.199", "0.299", "0.399", "0.499", "0.599",
    "0.699", "0.799", "0.899", "0.999", "1.099", "1.199"
  ] }
];

for (const { sampleRate, timestamps } of cases) {
  it(`matches native ebur128 timestamp precision at ${sampleRate} Hz and preserves PCM`, async () => {
    const toneFrames = sampleRate * timestamps.length / 10;
    const samples = Float64Array.from({ length: toneFrames + sampleRate / 50 }, (_, frame) =>
      frame < toneFrames ? Math.round(8192 * Math.sin(2 * Math.PI * 100 * frame / sampleRate)) / 32768 : 30000 / 32768);
    const input = encodeWav({ sampleRate, channels: [samples] });
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav",
        "-af", "ebur128=peak=sample", "-c:a", "pcm_s16le", "/out.wav"],
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
    const measurements = stderr.split("\n").filter(line => line.startsWith("t:"));
    assert.deepEqual(measurements.map(line => line.slice(3, line.indexOf(" TARGET:"))),
      timestamps.map(timestamp => timestamp.padEnd(10)));
    assert.deepEqual(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData);
  });
}
