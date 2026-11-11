import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767];
// Native FFmpeg PCM16 output for numeric suffixes, including arithmetic operands.
for (const [filter, expected] of [
  ["volume=1k", [-32768, -32768, -32768, -5000, -3000, -1000, 0, 1000, 3000, 5000, 32767, 32767, 32767]],
  ["volume=1K", [-32768, -32768, -32768, -5000, -3000, -1000, 0, 1000, 3000, 5000, 32767, 32767, 32767]],
  ["volume=1Ki", [-32768, -32768, -32768, -5120, -3072, -1024, 0, 1024, 3072, 5120, 32767, 32767, 32767]],
  ["volume=1ki", [-32768, -32768, -32768, -5120, -3072, -1024, 0, 1024, 3072, 5120, 32767, 32767, 32767]],
  ["volume=1B", [-32768, -32768, -32768, -40, -24, -8, 0, 8, 24, 40, 32767, 32767, 32767]],
  ["volume=1kB", [-32768, -32768, -32768, -32768, -24000, -8000, 0, 8000, 24000, 32767, 32767, 32767, 32767]],
  ["volume=1KiB", [-32768, -32768, -32768, -32768, -24576, -8192, 0, 8192, 24576, 32767, 32767, 32767, 32767]],
  ["volume=500m", [-16384, -15000, -10000, -2, -2, 0, 0, 0, 2, 2, 10000, 15000, 16384]],
  ["volume=500000u", [-16384, -15000, -10000, -2, -2, 0, 0, 0, 2, 2, 10000, 15000, 16384]],
  ["volume=1e-3k", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1E/1e18", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1E-3k", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1Y/1e24", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1Z/1e21", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1P/1e15", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1T/1e12", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1G/1e9", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1M/1e6", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=10d", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=100c", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=0.01h", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1n*1e9", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1p*1e12", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1f*1e15", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1a*1e18", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1z*1e21", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=1y*1e24", [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767]],
  ["volume=-1k", [32767, 32767, 32767, 5000, 3000, 1000, 0, -1000, -3000, -5000, -32768, -32768, -32768]],
  ["volume=1k/2", [-32768, -32768, -32768, -2500, -1500, -500, 0, 500, 1500, 2500, 32767, 32767, 32767]]
] as const) {
  it(`matches native PCM16 samples for ${filter}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual, value => value * 32768), expected);
  });
}

for (const expression of ["1kfoo", "1kb", "1Kii", "1KiBB", "1Q", "1e", "1E-", "1mystery"]) {
  it(`rejects trailing text in volume=${expression}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.5])] }));
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", "-af", `volume=${expression}`, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, 234);
    assert.equal(fs.existsSync("/out.wav"), false);
  });
}
