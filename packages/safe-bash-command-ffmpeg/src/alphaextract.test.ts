import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "4080c0ff4080c0800a141e00ff002040";

async function run(filter: string, outputFormat = "gray", bytes = input, inputFormat = "rgba") {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(bytes, "hex") });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", inputFormat, "-video_size", "2x2",
      "-framerate", "4", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough",
      ...(outputFormat ? ["-pix_fmt", outputFormat] : []), "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(stdout).toString("hex") };
}

it("extracts RGBA opacity as grayscale independently of RGB and luma", async () => {
  // Native FFmpeg 7.0.2-static with the same argv and bytes.
  const result = await run("alphaextract");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, "ff800040");
});

it("preserves the unfiltered RGBA control", async () => {
  const result = await run("null", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, input);
});

it("infers grayscale output and preserves multiple frames", async () => {
  const result = await run("alphaextract", "", input + "ffffff01000000feff00002000ff00c0");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, "ff80004001fe20c0");
});

it("passes extracted opacity to downstream grayscale filters", async () => {
  const result = await run("alphaextract,negate=components=y,hflip");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, "7f00bfff");
});

it("makes extracted grayscale opaque when converted to RGBA", async () => {
  const result = await run("alphaextract", "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output, "ffffffff808080ff000000ff404040ff");
});

for (const filter of ["alphaextract=bogus=1", "alphaextract=enable=0", "format=rgb24,alphaextract"]) {
  it(`rejects ${filter} without emitting output`, async () => {
    const result = await run(filter);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /alphaextract/);
    assert.equal(result.output, "");
  });
}

for (const [format, bytes] of [
  ["bgra", input],
  ["gbrap", "40800aff80401400c0c01e20ff800040"],
  ["ya8", "10ff208030004040"]
]) {
  it(`extracts opacity from ${format} input`, async () => {
    const result = await run("alphaextract", "gray", bytes, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output, "ff800040");
  });
}
