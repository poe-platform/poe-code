import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

async function run(input: Uint8Array, options: string[], outputOptions: string[]) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input) });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", ...options,
      "-i", "pipe:0", "-f", "s16le", ...outputOptions, "pipe:1"],
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

// Native FFmpeg 7.0.2: input -ar sets the raw demuxer's rate regardless of selector.
for (const option of ["-ar", "-ar:a", "-ar:a:0", "-ar:0", "-ar:v", "-ar:a:1", "-ar:1"]) {
  it(`uses ${option} as the raw input rate and resets it before output`, async () => {
    const input = Buffer.from("30f84ff86ef88df8acf8cbf8eaf809f928f947f966f985f9", "hex");
    const output = await run(input, [option, "4000"], ["-af", "atrim=duration=0.001"]);
    assert.equal(output.toString("hex"), "30f84ff86ef88df8");
  });
}

// Native FFmpeg 7.0.2: only the last matching output option controls resampling.
const input = Buffer.alloc(256);
for (let i = 0; i < 128; i++) input.writeInt16LE(i * 31 - 2000, i * 2);
for (const [options, resampled] of [
  [["-ar", "4000"], true],
  [["-ar:a", "4000"], true],
  [["-ar:a:0", "4000"], true],
  [["-ar:0", "4000"], true],
  [["-ar:v", "4000"], false],
  [["-ar:a:1", "4000"], false],
  [["-ar:1", "4000"], false],
  [["-ar", "4000", "-ar:v", "2000"], true],
  [["-ar:a", "4000", "-ar", "8000"], false],
  [["-ar", "8000", "-ar:a:0", "4000"], true],
  [["-ar:a", "4000", "-ar:a:0", "0"], false]
] as const) {
  it(`selects the output rate for ${options.join(" ")}`, async () => {
    const output = await run(input, [], [...options]);
    assert.equal(output.length, resampled ? 128 : 256);
    assert.equal(createHash("sha256").update(output).digest("hex"), resampled
      ? "79e9fc0f769a7c1a32f2a62f5e4eec76df9f4ed0ec0e1186cc6ba3ad43747c65"
      : "9c6c6ccaae84bb7a66556f04cdc141f9e05eb54fb2d376be2bfbd1f67b2e786a");
  });
}

for (const option of ["-ar:a", "-ar:a:0", "-ar:0", "-ar:v"]) {
  it(`uses ${option} in the synchronous input path`, () => {
    const volume = Volume.fromJSON({ "/in.raw": input });
    const result = evalSyncFfmpeg(
      ["-y", "-v", "error", "-f", "s16le", "-ac", "1", "-ar", "8000", option, "4000",
        "-i", "/in.raw", "/out.wav"], undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(result, "");
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 4000);
    assert.equal(audio.channelData[0]!.length, 128);
  });
}

it("resets the input rate options before the next raw input", async () => {
  const output = await run(input,
    ["-ar:a", "4000", "-i", "/in.raw", "-f", "s16le", "-ac", "1"],
    ["-map", "1:a", "-af", "atrim=duration=0.001"]);
  assert.deepEqual(output, input.subarray(0, 88));
});

for (const option of ["-ar:a:1", "-ar:1"]) {
  it(`applies ${option} only to the second mapped output stream`, async () => {
    const output = await run(input, [],
      ["-map", "0:a", "-map", "0:a", option, "4000", "-f", "streamhash", "-hash", "sha256"]);
    assert.equal(output.toString(),
      "0,a,SHA256=9c6c6ccaae84bb7a66556f04cdc141f9e05eb54fb2d376be2bfbd1f67b2e786a\n" +
      "1,a,SHA256=79e9fc0f769a7c1a32f2a62f5e4eec76df9f4ed0ec0e1186cc6ba3ad43747c65\n");
  });
}

it("resets rate options between output files", async () => {
  const output = await run(input, [], ["-ar:a", "4000", "/first.raw", "-f", "s16le"]);
  assert.deepEqual(output, input);
});
