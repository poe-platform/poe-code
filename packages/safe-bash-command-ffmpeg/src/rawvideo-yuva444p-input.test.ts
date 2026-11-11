import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format = "yuva444p", size = "4x2", outputArgs = ["-vf", "null", "-pix_fmt", "rgba"], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "4", "-i", "/in.raw", ...outputArgs, "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, output: Buffer.concat(stdout) };
}

// Native FFmpeg 7.0.2 output: distinct samples in every Y, U, V, and alpha position.
const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a65707b86919ca7b2", "hex");
const rgba = Buffer.from("bc003265007e5570007e787b007e9b86007dbe91047de19c237cffa7417cffb2", "hex");
for (const [format, expected] of [["yuva444p", rgba], ["rgba", input]] as const) {
  it(`matches native RGBA bytes for ${format} input through null`, async () => {
    const result = await run(input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.output, expected);
  });
}

for (const [width, height] of [[1, 1], [3, 2], [2, 4], [8, 1]] as const) {
  it(`reads full-resolution YUVA444 planes at ${width}x${height}`, async () => {
    const count = width * height;
    const bytes = Buffer.concat([0, 1, 2, 3].map(plane => input.subarray(plane * 8, plane * 8 + count)));
    const result = await run(bytes, "yuva444p", `${width}x${height}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.output, rgba.subarray(0, count * 4));
  });
}

it("keeps YUVA444 frame boundaries and full-resolution alpha, skipping a short final packet", async () => {
  const second = Buffer.from(input);
  second.set([0, 1, 127, 128, 254, 255, 64, 192], 24);
  const expected = Buffer.from(rgba);
  for (let i = 0; i < 8; i++) expected[i * 4 + 3] = second[24 + i]!;
  const bytes = Buffer.concat([input, second, input.subarray(0, 31)]);
  const result = await run(bytes);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.output, Buffer.concat([rgba, expected]));
  const selected = await run(bytes, "yuva444p", "4x2", ["-vf", "select=eq(t\\,0.25)", "-pix_fmt", "rgba"]);
  assert.equal(selected.exitCode, 0, selected.stderr);
  assert.deepEqual(selected.output, expected);
});

it("copies all four YUVA444 planes and a short final packet without decoding", async () => {
  const bytes = Buffer.concat([input, input.subarray(0, 31)]);
  const result = await run(bytes, "yuva444p", "4x2", ["-c:v", "copy"], { limits: { maxFrames: 0 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.output, bytes);
});

for (const limits of [{ maxFrames: 0 }, { maxSamplesPerTrack: 0 }, { maxMemoryBytes: 1 }, { maxOutputBytes: 31 }]) {
  it(`enforces YUVA444 resource limits before emitting output: ${JSON.stringify(limits)}`, async () => {
    const result = await run(input, "yuva444p", "4x2", undefined, { limits });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Resource limit exceeded/);
    assert.equal(result.output.length, 0);
  });
}
