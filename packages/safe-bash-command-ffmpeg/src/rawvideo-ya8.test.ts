import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference bytes for two 2x2 frames.
const ya8 = Buffer.from("113a638cb5de07305982abd4fd264f78", "hex");
const rgb24 = Buffer.from("113a638cb5de07305982abd4fd264f78a1caf31c456e97c0", "hex");
const grayAlpha = Buffer.from("32ffadff28ffa3ff6bff99ff61ff8fff", "hex");

async function run(bytes: Uint8Array, format: string, outputArgs: string[], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(bytes), "/out.raw": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", format, "-s", "2x2", "-r", "1",
      "-i", "/in.raw", ...outputArgs, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") };
}

it("copies both YA8 rawvideo packets byte for byte", async () => {
  const result = await run(ya8, "ya8", ["-c:v", "copy"], { features: { videoTranscode: false }, limits: { maxFrames: 0 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, ya8);
});

it("uses two bytes per pixel when limiting YA8 stream copy to one packet", async () => {
  const result = await run(ya8, "ya8", ["-c:v", "copy", "-frames:v", "1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, ya8.subarray(0, 8));
});

for (const copy of [false, true]) {
  it(`preserves YA8 luminance and alpha with a partial final packet (copy=${copy})`, async () => {
    const bytes = Buffer.concat([ya8, Buffer.from([90, 0])]);
    const result = await run(bytes, "ya8", ["-c:v", copy ? "copy" : "rawvideo"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, copy ? bytes : ya8);
  });
}

for (const filters of [[], ["-vf", "null"], ["-vf", "format=ya8"]]) {
  it(`serializes RGB24 as YA8 with native luminance and opaque alpha (${filters.join(" ") || "no filter"})`, async () => {
    const result = await run(rgb24, "rgb24", [...filters, "-pix_fmt", "ya8"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, grayAlpha);
  });
}

it("infers YA8 raw output from the format filter", async () => {
  const result = await run(rgb24, "rgb24", ["-vf", "format=ya8"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, grayAlpha);
});

it("keeps transparent luminance and partial alpha when explicitly encoding YA8", async () => {
  const bytes = Buffer.from([90, 0, 255, 128, 0, 255, 1, 1]);
  const result = await run(bytes, "ya8", ["-vf", "null", "-pix_fmt", "ya8"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, bytes);
});

it("checks the complete YA8 output size before replacing the destination", async () => {
  const result = await run(rgb24, "rgb24", ["-pix_fmt", "ya8"], { limits: { maxOutputBytes: 15 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.toString(), "keep");
});
