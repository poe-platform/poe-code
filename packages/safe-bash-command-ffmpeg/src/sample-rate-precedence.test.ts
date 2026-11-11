import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const raw = Buffer.from("30f84ff86ef88df8acf8cbf8eaf809f928f947f966f985f9", "hex");

// Native FFmpeg: -ar overrides the demuxer's -sample_rate in either order.
for (const [options, rate] of [
  [["-ar", "8000", "-sample_rate", "4000"], 8000],
  [["-ar", "4000", "-sample_rate", "8000"], 4000],
  [["-sample_rate", "4000", "-ar", "8000"], 8000],
  [["-sample_rate", "8000", "-ar", "4000"], 4000],
  [["-sample_rate", "4000"], 4000],
  [["-sample_rate", "8000", "-sample_rate", "4000"], 4000],
  [["-ar", "8000", "-ar", "4000", "-sample_rate", "8000"], 4000],
  [["-ar:a:0", "8000", "-sample_rate", "4000"], 8000]
] as const) {
  it(`uses ${rate} Hz for raw input with ${options.join(" ")}`, async () => {
    const volume = new Volume();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ac", "1", ...options, "-i", "pipe:0",
        "-af", "atrim=duration=0.001", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { yield raw; })(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Buffer.concat(stdout), raw.subarray(0, rate / 1000 * 2));
  });

  it(`uses ${rate} Hz for synchronous raw input with ${options.join(" ")}`, () => {
    const volume = Volume.fromJSON({ "/in.raw": raw });
    const result = evalSyncFfmpeg(
      ["-y", "-v", "error", "-f", "s16le", "-ac", "1", ...options, "-i", "/in.raw", "/out.wav"],
      undefined, path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(result, "");
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rate);
    assert.equal(audio.channelData[0]!.length, raw.length / 2);
  });
}

for (const [options, rate] of [
  [[], 44100],
  [["-sample_rate", "4000"], 4000]
] as const) {
  it(`resets both rate options before the next input at ${rate} Hz`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": raw });
    const args = ["-y", "-v", "error", "-f", "s16le", "-ac", "1", "-ar", "8000", "-sample_rate", "2000",
      "-i", "/in.raw", "-f", "s16le", "-ac", "2", ...options, "-i", "/in.raw", "/out.wav"];
    // Automatic selection chooses the second input because it has more channels.
    const syncResult = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(syncResult, "");
    assert.equal(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.sampleRate, rate);
    volume.unlinkSync("/out.wav");
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.sampleRate, rate);
  });
}
