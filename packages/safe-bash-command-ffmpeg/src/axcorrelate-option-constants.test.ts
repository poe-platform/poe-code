import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete s16le output from native FFmpeg 7.0.2 for these 12-sample inputs.
const fast = "e67fbc7f0a7f6879430cccbfef583c7d00db2585a6850080";
const best = "ff7fff7fff7fff7fff7fff7fff7f73997399ff7f2a900080";
for (const [options, expected] of [
  ["size=min:algo=fast", fast],
  ["size=2:algo=fast", fast],
  ["size=default", ""],
  ["size=256", ""],
  ["size=3:algo=max", best],
  ["size=3:algo=default", best],
  ["size=3:algo=best", best],
  ["min:fast", fast],
  ["size=max:algo=fast", ""],
  ["size=min+1:algo=default", best],
  ["size=2:algo=max-1", fast],
  ["size=2:algo=min+1", fast]
]) {
  it(`axcorrelate ${options} matches native status and complete PCM`, async () => {
    const fs = Volume.fromJSON({});
    for (const [name, step] of [["a", 137], ["b", 193]] as const) {
      fs.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 12 }, (_, i) => ((i * step) % 1700 - 850) / 32768)
      ] }));
    }
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
        `[0:a][1:a]axcorrelate=${options}[out]`, "-map", "[out]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
