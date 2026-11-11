import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const impulse = [1001, 0, 0, 0, 0, 0, 0, 0];

async function run(filter: string, samples = impulse, output = "pipe:1", format = "s16le") {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from(samples, sample => sample / 32768)] }));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-af", filter, "-f", format, output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, fs, stderr, bytes: Buffer.concat(chunks) };
}

for (const filter of ["anull", "asplit=1", "asplit=outputs=1", "asplit@single=1"]) {
  it(`preserves every impulse sample through ${filter}`, async () => {
    const { result, stderr, bytes } = await run(filter);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), impulse);
  });
}

for (const split of ["asplit=1", "asplit=outputs=1"]) {
  for (const chain of [
    `volume=2,${split},areverse`,
    `${split},pan=mono|c0=0.5*c0`,
    `apad,${split},atrim=end_sample=12`,
    `aloop=loop=-1:size=8,${split},atrim=end_sample=12`,
    `asetnsamples=n=3:p=0,asetpts=PTS+7,${split}`
  ]) {
    it(`preserves identity-filter behavior in ${chain}`, async () => {
      const format = chain.includes("asetpts") ? "framecrc" : "s16le";
      const control = await run(chain.replace(split, "anull"), impulse, "pipe:1", format);
      const actual = await run(chain, impulse, "pipe:1", format);
      assert.equal(control.result.exitCode, 0, control.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.bytes, control.bytes);
    });
  }
}

for (const filter of ["asplit", "asplit=2", "asplit=outputs=2", "asplit=0", "asplit=-1",
  "asplit=1.5", "asplit=", "asplit=unknown=1", "asplit=1:unknown=1"]) {
  it(`rejects ${filter} without replacing output`, async () => {
    const { result, fs } = await run(filter, impulse, "/out.pcm");
    assert.notEqual(result.exitCode, 0);
    assert.equal(fs.readFileSync("/out.pcm", "utf8"), "keep");
  });
}
