import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 48000, channels: [new Float64Array(128).fill(16000 / 32768)] });

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", input);
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]asetnsamples=n=16:p=0,${filter}[out]`, "-map", "[out]"]
      : ["-af", `asetnsamples=n=16:p=0,${filter}`]), "-f", "s16le", "pipe:1"],
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
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2: eight frames of 16 signed PCM16 samples of 16000 at 48 kHz.
  for (const [filter, hash] of [
    ["aexciter=listen=1:enable=random(0)", "662f5edd25cc7d97c930533f5c5ee9cc585f90bbe3c9de83b85906bae5f9fad9"],
    [String.raw`aexciter=listen=1:enable=randomi(0\,0\,1)`, "662f5edd25cc7d97c930533f5c5ee9cc585f90bbe3c9de83b85906bae5f9fad9"],
    ["aexciter=listen=1", "df7d1210eb7268706c08386c58d74855981cc67f1ee5d698a0e6910d5d65dac1"],
    ["anull", "364ea04dbbe98aaab6799d7725dbe75a56625498165e1c4ee6480d5bbf15cbce"]
  ] as const) {
    it(`${filter} matches native PCM on fresh runs (graph=${graph})`, async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const actual = await run(filter, graph);
        assert.equal(actual.exitCode, 0, actual.stderr);
        assert.equal(actual.stderr, "");
        assert.equal(actual.stdout.length, 256);
        assert.equal(createHash("sha256").update(actual.stdout).digest("hex"), hash);
      }
    });
  }

  it(`keeps random state independent between filter instances (graph=${graph})`, async () => {
    const random = "aexciter=listen=1:enable=random(0)";
    const fixed = "aexciter=listen=1:enable='eq(n,0)+eq(n,3)+eq(n,4)'";
    assert.deepEqual(await run(`${random},${random}`, graph), await run(`${fixed},${fixed}`, graph));
  });

  it(`restarts random state when a timeline command replaces the expression (graph=${graph})`, async () => {
    const actual = await run("asendcmd=c='0.001 aexciter enable random(0)',aexciter=listen=1:enable=random(0)", graph);
    const expected = await run("aexciter=listen=1:enable='eq(n,0)+eq(n,3)+eq(n,6)+eq(n,7)'", graph);
    assert.equal(expected.exitCode, 0, expected.stderr);
    assert.deepEqual(actual, expected);
  });

  for (const expression of ["random(0,1)", "randomi(0,1)"]) {
    it(`rejects malformed ${expression} without output (graph=${graph})`, async () => {
      const actual = await run(`aexciter=listen=1:enable='${expression}'`, graph);
      assert.notEqual(actual.exitCode, 0);
      assert.ok(actual.stderr.includes("aexciter enable: invalid or unsupported expression"), actual.stderr);
      assert.equal(actual.stdout.length, 0);
    });
  }
}
