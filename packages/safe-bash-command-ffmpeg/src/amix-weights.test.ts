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

// Native FFmpeg 7.0.2 output, including the longer first input's tail.
for (const [weights, expected] of [
  ["x1", "43fd21037bfc0704000000000000"],
  ["0 1", "43fd21037bfc0704000000000000"],
  ["1 abc", "e9032df8bd0ba70feb137917b3e2"],
  ["1 0", "e9032df8bd0ba70feb137917b3e2"],
  ["abc", "0000000000000000000000000000"],
  ["bad", "0000000000000000000000000000"],
  ["x", "0000000000000000000000000000"],
  ["+x1", "0000000000000000000000000000"],
  ["dB1", "0000000000000000000000000000"],
  ["0 0", "0000000000000000000000000000"],
  ["1x2", "7aff7aff9101e707a406d3073bf6"],
  ["1 2", "7aff7aff9101e707a406d3073bf6"]
] as const) {
  it(`matches native raw PCM for amix weights=${JSON.stringify(weights)}`, async () => {
    const volume = new Volume();
    volume.writeFileSync("/a.pcm", Buffer.from("e9032df8bd0ba70feb137917b3e2", "hex"));
    volume.writeFileSync("/b.pcm", Buffer.from("43fd21037bfc0704", "hex"));
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/a.pcm",
        "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/b.pcm", "-filter_complex",
        `[0:a][1:a]amix=weights=${weights}[o]`, "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
