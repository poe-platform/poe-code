import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const options of [[], ["-readrate", "0"], ["-readrate", "1"], ["-re"], ["-readrate", "0.5"]]) {
  it(`preserves WAV PCM with input pacing ${options.join(" ") || "control"}`, async () => {
    const result = await execute(options);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length, 192);
    assert.equal(createHash("sha256").update(result.stdout).digest("hex"),
      "d78d19f717c9404f29c3efaebdb58bddfbbc8ccf602f5c732811b4ee68c71a2c");
    assert.ok(!result.stderr.includes("silence_"));
  });
}
for (const value of ["-1", "NaN", "Infinity", "broken", "", "1junk"]) {
  it(`rejects invalid input readrate ${JSON.stringify(value)} without output`, async () => {
    const result = await execute(["-readrate", value]);
    assert.equal(result.exitCode, 234, result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.ok(result.stderr.includes("readrate"));
  });
}
for (const option of [["-re"], ["-readrate", "1"]]) {
  it(`rejects output placement of ${option.join(" ")}`, async () => {
    const result = await execute([], option);
    assert.equal(result.exitCode, 234, result.stderr);
    assert.equal(result.stdout.length, 0);
  });
}

async function execute(options: string[], outputOptions: string[] = []) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length: 48 }, (_, i) => (i >= 8 && i < 16 || i >= 34 ? 5000 : 0) / 32768),
    Float64Array.from({ length: 48 }, (_, i) => (i >= 11 && i < 19 || i >= 32 && i < 38 ? -8000 : 0) / 32768)
  ] }));
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-loglevel", "info", ...options,
      "-i", "in.wav", ...outputOptions, "-af", "anull", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}
