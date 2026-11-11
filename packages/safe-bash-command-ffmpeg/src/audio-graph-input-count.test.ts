import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 13 }, (_, i) => [(i + 1) * 101, -(i + 1) * 203]);

async function run(filter: string, inputCount: number, destination = "pipe:1") {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [0, 1].map(channel => Float64Array.from(samples, frame => frame[channel]! / 32768)) }));
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-filter_complex",
      `${"[0:a]".repeat(inputCount)}${filter}[o]`, "-map", "[o]", "-f", "s16le", destination],
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
  return { ...result, stderr, stdout: Buffer.concat(stdout), output: volume.readFileSync("/out.pcm", "utf8") };
}

for (const filter of ["anull", "volume=1", "volume@gain=1"]) {
  for (const inputCount of [2, 3]) {
    for (const destination of ["pipe:1", "/out.pcm"]) {
      it(`rejects ${inputCount} labels on ${filter} with native status and no output (${destination})`, async () => {
        const result = await run(filter, inputCount, destination);
        assert.equal(result.exitCode, 234, result.stderr);
        assert.ok(result.stderr.includes(
          `More input link labels specified for filter '${filter.split("=", 1)[0]}' than it has inputs: ${inputCount} > 1`
        ), result.stderr);
        assert.equal(result.stdout.length, 0);
        assert.equal(result.output, "keep");
      });
    }
  }

  it(`preserves stereo PCM through ${filter} with one input label`, async () => {
    const result = await run(filter, 1);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const expected = Buffer.alloc(samples.length * 4);
    samples.flat().forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
    assert.deepEqual(result.stdout, expected);
  });
}
