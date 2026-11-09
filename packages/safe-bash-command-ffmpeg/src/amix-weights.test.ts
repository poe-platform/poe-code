import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for constant +8000 and -4000 inputs.
for (const [weights, normalize, expected] of [
  ["0b10 1", true, -4000],
  ["1/2 1", true, 0],
  ["2dB 1", true, 2688],
  ["-6dB 1", true, 6],
  ["0.5 1", true, 0],
  ["1e-1 1", true, -2909],
  ["0x2 1", true, 4000],
  ["0x1p2 1", true, -4000],
  ["-0x1p2 1", true, -7200],
  ["1k 1", true, 7988],
  ["1Ki 1", true, 7988],
  ["1B 1", true, 6667],
  ["1,2", true, 0],
  ["1+2", true, 0],
  ["1\t2", true, 0],
  ["1 2 3", true, 0],
  ["2", true, 2000],
  ["2dB 1", false, 6071],
  ["1m 1", false, -3992],
  ["1/2 1", false, 0],
  ["0b10 1", false, -32768]
] as const) {
  it(`matches native decoded amix weights=${JSON.stringify(weights)}, normalize=${normalize}`, async () => {
    const volume = new Volume();
    for (const [path, sample] of [["/a.wav", 8000], ["/b.wav", -4000]] as const) {
      volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(2048).fill(sample / 32768)] }));
    }
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
        `[0:a][1:a]amix=weights='${weights}':normalize=${Number(normalize)}[o]`,
        "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), Array(2048).fill(expected));
  });
}
