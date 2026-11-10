import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg rounds duration to samples, including zero below half a sample.
for (const duration of ["0.57", "0", "0.0624", "0.56", "0.0625"]) {
  it(`matches native silencedetect events and PCM for d=${duration} at 8 Hz`, async () => {
    const samples = [...Array<number>(8).fill(0), ...Array<number>(4).fill(8000), ...Array<number>(4).fill(0)];
    const input = encodeWav({ sampleRate: 8, channels: [Float64Array.from(samples, value => value / 32768)] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-loglevel", "info", "-i", "/in.wav",
        "-af", `silencedetect=d=${duration}`, "-f", "s16le", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const expectedPcm = Buffer.alloc(samples.length * 2);
    samples.forEach((value, index) => expectedPcm.writeInt16LE(value, index * 2));
    assert.deepEqual(Buffer.concat(chunks), expectedPcm);
    const zeroSamples = duration === "0" || duration === "0.0624";
    assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), [
      `silence_start: ${zeroSamples ? "0.125" : "0"}`,
      `silence_end: 1 | silence_duration: ${zeroSamples ? "0.875" : "1"}`,
      ...(duration === "0.57" ? [] : [
        `silence_start: ${zeroSamples ? "1.625" : "1.5"}`,
        `silence_end: 2 | silence_duration: ${zeroSamples ? "0.375" : "0.5"}`
      ])
    ]);
  });
}
