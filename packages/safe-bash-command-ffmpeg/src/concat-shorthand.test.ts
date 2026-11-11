import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
const input = Buffer.from(encodeWav({
  sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)]
}));

for (const options of ["v=0:2:0:1", "2:v=0:1"]) {
  for (const output of ["pipe:1", "/out.raw"]) {
    it(`rejects incompatible concat shorthand without writing output: ${options}, ${output}`, async () => {
      const result = await run(options, output);
      assert.notEqual(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.length, 0);
      assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "KEEP");
    });
  }
}

for (const options of [
  "2:0:1", "n=2:0:1", "n=2:v=0:a=1", "v=0:a=1:2:0:1",
  "2:v=0:2:0:1", "v=0:a=1:threads=1:0:1"
]) {
  it(`preserves concatenated PCM with shorthand: ${options}`, async () => {
    const result = await run(options, "pipe:1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(Array.from({ length: result.stdout.length / 2 }, (_, i) =>
      result.stdout.readInt16LE(i * 2)), [...samples, ...samples]);
  });
}

async function run(options: string, output: string) {
  const volume = Volume.fromJSON({ "/in.wav": input, "/out.raw": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-filter_complex",
      `[0:a][0:a]concat=${options}[o]`, "-map", "[o]", "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.wav"), input);
  return { ...result, stdout: Buffer.concat(stdout), stderr, volume };
}
