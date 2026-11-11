import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-20001, 0, 20001];
// Native FFmpeg PCM16 output for PI arithmetic and ordinary gain controls.
for (const [filter, expected] of [
  ["volume=PI/4", [-15709, 0, 15709]],
  ["volume=PI/4:eval=frame", [-15709, 0, 15709]],
  ["volume=1", [-20001, 0, 20001]],
  ["volume=0.5", [-10000, 0, 10000]],
  ["volume=2", [-32768, 0, 32767]]
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

for (const expression of ["banana", "PIbanana", "pi"]) {
  it(`rejects unknown identifiers in volume=${expression}`, async () => {
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
