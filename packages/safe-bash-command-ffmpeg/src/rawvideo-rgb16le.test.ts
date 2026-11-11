import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, source: string, target: string, options: Parameters<typeof createFfmpegCommand>[0] = {}, copy = false) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", source,
      "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
      ...(copy ? ["-c:v", "copy"] : ["-vf", "null"]), "-fps_mode", "passthrough",
      "-pix_fmt", target, "-bitexact", "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2, one 2x2 frame at 4 fps; low bytes must survive decoding.
for (const [format, inputHex, packed8, grayOutput] of [
  ["rgb48le", "39008c00df0032018501d8012b027e02d10224037703ca03",
    "000101010202020203030304", "000a000a000a000b000b000b001e001e001e001f001f001f"],
  ["rgba64le", "39008c00df0032018501d8012b027e02d10224037703ca031d007000c3001601",
    "00010101020202020303030400000101", "000a000a000affff000b000b000bffff001e001e001effff001f001f001fffff"]
] as const) {
  const input = Buffer.from(inputHex, "hex");
  const bigEndian = format === "rgb48le" ? "rgb48be" : "rgba64be";

  it(`preserves every ${format} sample through null across multiple frames`, async () => {
    const frames = Buffer.concat([input, Buffer.from(input).reverse()]);
    const result = await run(frames, format, format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, frames);
  });

  it(`decodes ${format} channels in little-endian order`, async () => {
    const result = await run(input, format, format === "rgb48le" ? "rgb24" : "rgba");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), packed8);
  });

  it(`writes native grayscale expansion to ${format}`, async () => {
    const result = await run(Buffer.from("0a0b1e1f", "hex"), "gray", format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), grayOutput);
  });

  for (const reverse of [false, true]) {
    it(`preserves all bits converting ${reverse ? bigEndian : format} to ${reverse ? format : bigEndian}`, async () => {
      const swapped = Buffer.from(input).swap16();
      const result = await run(reverse ? swapped : input, reverse ? bigEndian : format, reverse ? format : bigEndian);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, reverse ? input : swapped);
    });
  }

  it(`retains partial ${format} packets for stream copy only`, async () => {
    const partial = Buffer.concat([input, input.subarray(0, 3)]);
    for (const copy of [false, true]) {
      const result = await run(partial, format, format, {}, copy);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, copy ? partial : input);
    }
  });

  for (const source of [format, "gray"]) {
    it(`checks output limits before replacing ${source} to ${format}`, async () => {
      const result = await run(source === "gray" ? Buffer.from("0a0b1e1f", "hex") : input, source, format,
        { limits: { maxOutputBytes: input.length - 1 } });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /maxOutputBytes/);
      assert.equal(result.output.toString(), "KEEP");
    });
  }
}

// Native FFmpeg 7.0.2 RGB expansion, including the opaque alpha added to RGBA64.
for (const [format, expected] of [
  ["rgb48le", "0311fb2d044bfe670185fda1ffbe02dcfef80416fc320550"],
  ["rgba64le", "0311fb2d044bfffffe670185fda1ffffffbe02dcfef8ffff0416fc320550ffff"]
] as const) {
  it(`writes expanded RGB24 channels as ${format}`, async () => {
    const input = Buffer.from(Array.from({ length: 12 }, (_, i) => (i * 29 + 17) % 256));
    const result = await run(input, "rgb24", format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}
