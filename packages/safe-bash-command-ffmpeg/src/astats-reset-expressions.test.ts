import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(reset: string, metadata = 0) {
  const input = encodeWav({
    sampleRate: 8000,
    channels: [Float64Array.from({ length: 2400 }, (_, i) => i < 2000 ? 0 : 0.5)]
  });
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af", `astats=reset=${reset}:metadata=${metadata}`, "-f", "s16le", "-"],
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
  return { ...result, stderr, output: Buffer.concat(stdout) };
}

// FFmpeg 7.0.2: 2000 silent samples followed by 400 samples at 16384.
for (const [reset, samples, peaks, depth] of [
  ["3", 864, 400, "1/1/2/1"],
  ["2+1", 864, 400, "1/1/2/1"],
  ["2", 352, 352, "1/1/0/0"],
  ["2.5", 352, 352, "1/1/0/0"],
  ["1.5", 352, 352, "1/1/0/0"],
  ["3.5", 352, 352, "1/1/0/0"],
  ["2.6", 864, 400, "1/1/2/1"],
  ["5/2", 352, 352, "1/1/0/0"],
  ["0.5", 2400, 400, "1/1/2/1"]
] as const) {
  for (const metadata of [0, 1]) {
    it(`astats reset=${reset}:metadata=${metadata} evaluates and rounds before resetting statistics`, async () => {
      const result = await run(reset, metadata);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.length, 4800);
      assert.equal(createHash("sha256").update(result.output).digest("hex"), "f5cc9cb6b8345be6d8ab9db678c377dc610c2c685a07992b0dc87aca50d7a719");
      const overall = result.stderr.split("Overall\n")[1]!;
      for (const [label, value] of [
        ["Max level", "16384.000000"],
        ["Abs Peak count", peaks.toFixed(6)],
        ["Bit depth", depth],
        ["Number of samples", String(samples)]
      ]) {
        assert.equal(overall?.split(`${label}: `)[1]?.split("\n")[0], value, result.stderr);
      }
    });
  }
}

for (const reset of ["-0.1", "2147483647.1", "2147483647+1", "1/0", "NaN", "nope", "", "2+"]) {
  it(`rejects invalid astats reset ${JSON.stringify(reset)} before emitting PCM`, async () => {
    const result = await run(reset);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("astats:"), result.stderr);
    assert.equal(result.output.length, 0);
  });
}
