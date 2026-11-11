import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const raw = Buffer.from("30f84ff86ef88df8acf8cbf8eaf809f928f947f966f985f9", "hex");

for (const option of ["-ac", "-ac:a", "-ac:v", "-ac:a:1", "-ac:1"]) {
  it(`uses the last input ${option} count for raw PCM channel splitting`, async () => {
    const volume = new Volume();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", option, "2",
        "-i", "pipe:0", "-af", "channelsplit=stereo:FR", "-f", "s16le", "pipe:1"],
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
    // Native FFmpeg 7.0.2: six right-channel samples, without mono upmixing.
    assert.equal(Buffer.concat(stdout).toString("hex"), "4ff88df8cbf809f947f985f9");
  });

  it(`uses the last input ${option} count in synchronous raw PCM decoding`, () => {
    const volume = new Volume();
    volume.writeFileSync("/in.raw", raw);
    const result = evalSyncFfmpeg(
      ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", option, "2", "-i", "/in.raw", "/out.wav"],
      undefined, path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }
    );
    assert.equal(result, "");
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 8000);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      [Array.from({ length: 6 }, (_, i) => raw.readInt16LE(i * 4)),
        Array.from({ length: 6 }, (_, i) => raw.readInt16LE(i * 4 + 2))]);
  });
}
