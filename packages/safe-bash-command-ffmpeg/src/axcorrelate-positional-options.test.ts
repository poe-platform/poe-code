import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string) {
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
  return { result, output: Buffer.concat(stdout), error: Buffer.concat(stderr).toString() };
}

// Complete s16le output from native FFmpeg 7.0.2 for the twelve-sample inputs above.
for (const [options, hex] of [
  ["size=3:algo=fast:2", "e67fbc7f0a7f6879430cccbfef583c7d00db2585a6850080"],
  ["size=3:algo=fast:4", "da7e667c6870cf3c951d1d57d1eaf5c7a7b35a8da6850080"],
  ["size=2:algo=fast", "e67fbc7f0a7f6879430cccbfef583c7d00db2585a6850080"],
  ["size=4:algo=fast", "da7e667c6870cf3c951d1d57d1eaf5c7a7b35a8da6850080"],
  ["size=3:algo=fast", "987fd37e1d7b175d90fbe31cb87011ec98ba5a8da6850080"]
]) {
  it(`axcorrelate=${options} matches native status and complete PCM`, async () => {
    const { result, output, error } = await run(options!);
    assert.equal(result.exitCode, 0, error);
    assert.equal(output.toString("hex"), hex);
  });
}

for (const options of ["size=3:2:fast", "2:size=3:fast:size=2", "size=3:algo=slow:2:fast"]) {
  it(`axcorrelate=${options} advances positional slots only for positional options`, async () => {
    const { result, output, error } = await run(options);
    assert.equal(result.exitCode, 0, error);
    assert.equal(output.toString("hex"), "e67fbc7f0a7f6879430cccbfef583c7d00db2585a6850080");
  });
}

it("axcorrelate rejects a third positional option without emitting PCM", async () => {
  const { result, output, error } = await run("size=3:2:fast:4");
  assert.equal(result.exitCode, 1, error);
  assert.ok(error.includes("axcorrelate:"), error);
  assert.equal(output.length, 0);
});
