import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 2x2 planar G/B/R/A float samples, including out-of-range values.
const samples = [-0.25, 0.125, 0.5, 1.5, 0.375, 0.25, 2, 0.75, 0.75, 1, -0.5, 0.0625, 0.125, 0.25, 0.5, 1];
const bytes = Buffer.alloc(samples.length * 4);
samples.forEach((sample, index) => bytes.writeFloatLE(sample, index * 4));

async function run(input: Buffer, format: string, options: Parameters<typeof createFfmpegCommand>[0] = {}, copy = false) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
      "-i", "/in.raw", ...(copy ? ["-c:v", "copy"] : ["-pix_fmt", "rgba"]), "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const [format, size, expected] of [
  ["grayf32le", 16, "000000ff131313ff828282ffffffffff"],
  ["gbrpf32le", 48, "c00060ffff2040ff0080ffff10ffc0ff"],
  ["gbrapf32le", 64, "c0006020ff2040400080ff8010ffc0ff"]
] as const) {
  const input = bytes.subarray(0, size);
  it(`decodes ${format} with native channel order, clipping and alpha`, async () => {
    const result = await run(input, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });

  it(`separates ${format} frames and ignores an incomplete decoded packet`, async () => {
    const result = await run(Buffer.concat([input, input, input.subarray(0, 3)]), format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected.repeat(2));
  });

  it(`copies ${format} packets without decoding or dropping partial data`, async () => {
    const partial = Buffer.concat([input, input.subarray(0, 3)]);
    const result = await run(partial, format, { limits: { maxFrames: 0 } }, true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, partial);
  });

  for (const limits of [{ maxFrames: 0 }, { maxPixelsPerFrame: 3 }, { maxOutputBytes: 15 }]) {
    it(`enforces ${format} limits ${JSON.stringify(limits)} before replacing output`, async () => {
      const result = await run(input, format, { limits });
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes(Object.keys(limits)[0]!), result.stderr);
      assert.equal(result.output.toString(), "KEEP");
    });
  }
}
