import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const samples = Array.from({ length: 2400 }, (_, i) => [0, 512, 256, 16384][i % 4]! / 32768);
const wav = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] });

async function run(args: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", wav);
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", ...args],
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
  return { ...result, stdout: Buffer.concat(stdout), stderr, volume };
}

for (const flags of [[], ["-auto_conversion_filters"], ["-noauto_conversion_filters"],
  ["-noauto_conversion_filters", "-auto_conversion_filters"],
  ["-auto_conversion_filters", "-noauto_conversion_filters"]]) {
  for (const format of ["s16le", "f32le"]) {
    it(`${flags.join(" ") || "default conversion"}: anull to ${format}`, async () => {
      const result = await run([...flags, "-i", "/in.wav", "-af", "anull", "-f", format, "-"]);
      if (flags.at(-1) === "-noauto_conversion_filters" && format === "f32le") {
        assert.equal(result.exitCode, 234, result.stderr);
        assert.equal(result.stdout.length, 0);
        assert.ok(result.stderr.includes("do not have a common format and automatic conversion is disabled"), result.stderr);
        return;
      }
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = Buffer.alloc(samples.length * (format === "s16le" ? 2 : 4));
      samples.forEach((sample, i) => {
        if (format === "s16le") expected.writeInt16LE(sample * 32768, i * 2);
        else expected.writeFloatLE(sample, i * 4);
      });
      assert.deepEqual(result.stdout, expected);
      assert.ok(!result.stderr.includes("Unrecognized option"), result.stderr);
    });
  }
}

it("applies a trailing global flag to an earlier output", async () => {
  const result = await run(["-i", "/in.wav", "-af", "anull", "-f", "f32le", "-", "-noauto_conversion_filters"]);
  assert.equal(result.exitCode, 234, result.stderr);
  assert.equal(result.stdout.length, 0);
});

it("checks the implicit audio graph when no filter was requested", async () => {
  const result = await run(["-noauto_conversion_filters", "-i", "/in.wav", "-f", "f32le", "-"]);
  assert.equal(result.exitCode, 234, result.stderr);
  assert.equal(result.stdout.length, 0);
});

for (const options of [["-ar", "16000"], ["-ac", "2"], ["-af", "aformat=flt"],
  ["-af", "aformat=sample_rates=16000"], ["-af", "aformat=channel_layouts=stereo"]]) {
  it(`rejects implicit conversion for ${options.join(" ")}`, async () => {
    const result = await run(["-noauto_conversion_filters", "-i", "/in.wav", ...options, "-f", "s16le", "-"]);
    assert.equal(result.exitCode, 234, result.stderr);
    assert.equal(result.stdout.length, 0);
  });
}

it("allows explicit resampling with automatic conversion disabled", async () => {
  const result = await run(["-noauto_conversion_filters", "-i", "/in.wav", "-af", "aresample=16000", "-ar", "16000", "-f", "s16le", "-"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, samples.length * 4);
});

it("leaves stream copy unaffected", async () => {
  const result = await run(["-noauto_conversion_filters", "-i", "/in.wav", "-c:a", "copy", "-f", "s16le", "-"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, samples.length * 2);
});

it("delegates conversion flags from the synchronous path without writing", () => {
  for (const flag of ["-auto_conversion_filters", "-noauto_conversion_filters"]) {
    assert.equal(evalSyncFfmpeg([flag, "-i", "/in.wav", "-f", "f32le", "-"], undefined,
      () => wav, () => assert.fail("must delegate without writing")), undefined);
  }
});

for (const format of ["s16le", "f32le"]) {
  it(`honors disabled conversion in a mapped anull graph to ${format}`, async () => {
    const result = await run(["-noauto_conversion_filters", "-i", "/in.wav",
      "-filter_complex", "[0:a]anull[out]", "-map", "[out]", "-f", format, "-"]);
    assert.equal(result.exitCode, format === "s16le" ? 0 : 234, result.stderr);
    assert.equal(result.stdout.length, format === "s16le" ? samples.length * 2 : 0);
  });
}

it("keeps the global flag across output boundaries", async () => {
  const result = await run(["-noauto_conversion_filters", "-i", "/in.wav",
    "-af", "anull", "/first.wav", "-af", "anull", "-f", "f32le", "-"]);
  assert.equal(result.exitCode, 234, result.stderr);
  assert.ok(result.volume.existsSync("/first.wav"));
  assert.equal(result.stdout.length, 0);
});

it("accepts compatible aformat constraints without conversion", async () => {
  const result = await run(["-noauto_conversion_filters", "-i", "/in.wav",
    "-af", "aformat=sample_fmts=flt|s16:sample_rates=16000|8000:channel_layouts=stereo|mono", "-f", "s16le", "-"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, samples.length * 2);
});
