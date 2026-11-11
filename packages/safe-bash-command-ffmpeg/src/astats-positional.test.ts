import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 2000 silent PCM16 samples followed by 400 samples at 16384.
const input = encodeWav({
  sampleRate: 8000,
  channels: [Float64Array.from({ length: 2400 }, (_, i) => i < 2000 ? 0 : 0.5)]
});

async function run(filter: string) {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af", filter, "-f", "s16le", "-"],
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
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr, volume };
}

for (const options of [
  "0.05:0:1:none:Max_level+Number_of_samples",
  "0.05:0:1:measure_perchannel=none:measure_overall=Max_level+Number_of_samples"
]) {
  it(`astats=${options} matches named options and native PCM and measurements`, async () => {
    const named = await run("astats=length=0.05:metadata=0:reset=1:measure_perchannel=none:measure_overall=Max_level+Number_of_samples");
    const positional = await run(`astats=${options}`);
    for (const result of [named, positional]) {
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.length, 4800);
      assert.equal(createHash("sha256").update(result.stdout).digest("hex"), "f5cc9cb6b8345be6d8ab9db678c377dc610c2c685a07992b0dc87aca50d7a719");
      assert.equal(result.stderr, "Overall\nMax level: 16384.000000\nNumber of samples: 352\n");
    }
    assert.deepEqual(positional.stdout, named.stdout);
  });
}

for (const [positional, named] of [
  ["0.02:0", "length=0.02:metadata=0"],
  ["0.05:1:1:Max_level:Number_of_samples", "length=0.05:metadata=1:reset=1:measure_perchannel=Max_level:measure_overall=Number_of_samples"]
]) {
  it(`astats=${positional} preserves defaults and matches named frame metadata`, async () => {
    const suffix = ",ametadata=mode=print:file=tags.txt";
    const expected = await run(`astats=${named}${suffix}`);
    const actual = await run(`astats=${positional}${suffix}`);
    assert.equal(expected.exitCode, 0, expected.stderr);
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.deepEqual(actual.stdout, expected.stdout);
    assert.equal(actual.stderr, expected.stderr);
    assert.equal(actual.volume.readFileSync("/tags.txt", "utf8"), expected.volume.readFileSync("/tags.txt", "utf8"));
  });
}

for (const options of [
  "0.05:2", "0.05:0:-1", "0.05:0:1:unknown", "0.05:0:1:none:unknown",
  "0.05:0:1:none:none:0"
]) {
  it(`rejects invalid positional astats=${options} before emitting PCM`, async () => {
    const result = await run(`astats=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("astats:"), result.stderr);
    assert.equal(result.stdout.length, 0);
  });
}
