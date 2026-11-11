import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function convert(input: Uint8Array, inputOptions: string[], outputOptions: string[]) {
  const volume = new Volume();
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", ...inputOptions, "-ac", "1", "-i", "pipe:0",
      ...outputOptions, "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () { yield input; })(),
    stdout: { async write(data: Uint8Array) { stdout.push(data.slice()); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return Buffer.concat(stdout);
}

const shortInput = Buffer.from("30f84ff86ef88df8acf8cbf8eaf809f928f947f966f985f9", "hex");
for (const outputOptions of [[], ["-sample_rate", "4000"]]) {
  it(`preserves raw PCM with output options ${outputOptions.join(" ") || "none"}`, async () => {
    assert.deepEqual(await convert(shortInput, ["-ar", "8000"], outputOptions), shortInput);
  });
}

for (const outputOptions of [[], ["-sample_rate", "8000"]]) {
  it(`retains input -sample_rate with output options ${outputOptions.join(" ") || "none"}`, async () => {
    assert.deepEqual(await convert(shortInput, ["-sample_rate", "4000"],
      [...outputOptions, "-af", "atrim=duration=0.001"]), shortInput.subarray(0, 8));
  });
}

// Native FFmpeg 7.0.2: output -sample_rate does not override -ar in either order.
for (const outputOptions of [
  ["-ar", "4000"],
  ["-sample_rate", "8000", "-ar", "4000"],
  ["-ar", "4000", "-sample_rate", "8000"]
]) {
  it(`preserves explicit resampling with ${outputOptions.join(" ")}`, async () => {
    const input = Buffer.alloc(256);
    for (let i = 0; i < 128; i++) input.writeInt16LE(i * 31 - 2000, i * 2);
    const output = await convert(input, ["-ar", "8000"], outputOptions);
    assert.equal(output.length, 128);
    assert.equal(createHash("sha256").update(output).digest("hex"),
      "79e9fc0f769a7c1a32f2a62f5e4eec76df9f4ed0ec0e1186cc6ba3ad43747c65");
  });
}

it("accepts output -sample_rate through synchronous execution without resampling", () => {
  const volume = new Volume();
  assert.equal(evalSyncFfmpeg(shortInput,
    ["-y", "-v", "error", "-f", "s16le", "-sample_rate", "8000", "-ac", "1", "-i", "pipe:0",
      "-sample_rate", "4000", "-f", "s16le", "/out.raw"],
    () => undefined,
    (path, data) => { volume.writeFileSync(path, data); return true; }), "");
  assert.deepEqual(volume.readFileSync("/out.raw"), shortInput);
});
