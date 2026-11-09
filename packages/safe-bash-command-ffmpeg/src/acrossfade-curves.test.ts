import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string) {
  const volume = Volume.fromJSON({ "/out.pcm": "sentinel" });
  for (const [name, value] of [["a", 12000], ["b", -4000]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(256).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
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
  return { result, stderr, output: volume.readFileSync("/out.pcm") };
}

for (const key of ["c1", "curve1", "c2", "curve2", "positional"]) {
  for (const value of ["0", "0.0", "1-1", "0+0", "tri+0"]) {
    it(`acrossfade ${key}=${value} matches triangular PCM exactly`, async () => {
      const expected = await run("ns=128:c1=tri:c2=tri");
      const actual = await run(key === "positional" ? `128:0:1:${value}:${value}` : `ns=128:${key}=${value}`);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(actual.output.length, 384 * 2);
      assert.deepEqual(actual.output, expected.output);
    });
  }
  for (const value of ["qsin", "1", "1+1", "-1", "1/0", "0/0", "0+", "unknown", ""]) {
    it(`acrossfade rejects ${key}=${value} without replacing output`, async () => {
      const actual = await run(key === "positional" ? `128:0:1:${value}:${value}` : `ns=128:${key}=${value}`);
      assert.equal(actual.result.exitCode, 1, actual.stderr);
      assert.ok(actual.stderr.includes("acrossfade:"), actual.stderr);
      assert.equal(actual.output.toString(), "sentinel");
    });
  }
}
