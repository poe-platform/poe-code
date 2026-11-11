import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string) {
  const volume = Volume.fromJSON({});
  for (const [name, length, value] of [["a", 1301, 12000], ["b", 891, -4000]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(length).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]acrossfade=${options}[mix]`, "-map", "[mix]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.existsSync("/out.pcm") ? volume.readFileSync("/out.pcm") : undefined };
}

for (const key of ["ns=", "nb_samples=", ""]) {
  for (const [expression, literal] of [["2*64", 128], ["127.5", 128], ["127.4", 127], ["126.5", 126], ["1", 1]]) {
    it(`acrossfade ${key}${expression} matches literal ${literal} PCM bytes`, async () => {
      const actual = await run(`${key}${expression}`);
      const expected = await run(`ns=${literal}`);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(expected.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output);
      assert.equal(actual.output!.length, Math.max(0, 2192 - Number(literal)) * 2);
    });
  }
}

it("acrossfade accepts the maximum sample count before a duration override", async () => {
  const actual = await run("ns=214748364:d=0.016");
  const expected = await run("ns=128");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(expected.exitCode, 0, expected.stderr);
  assert.deepEqual(actual.output, expected.output);
});

for (const value of ["0", "0.9", "-1", "214748364.1", "214748365", "2147483647", "2*2147483647", "1/0", "0/0", "nope", "2*", ""]) {
  it(`acrossfade rejects invalid sample count ${value} before rounding`, async () => {
    const result = await run(`ns=${value}`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /acrossfade:/);
    assert.equal(result.output, undefined);
  });
}
