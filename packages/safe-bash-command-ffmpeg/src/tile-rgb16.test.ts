import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, filter: string, format = "rgb48le", outputFormat = format) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const argumentValues = createCommandArguments([
    "-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
    "-framerate", "4", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough",
    "-pix_fmt", outputFormat, "-bitexact", "-f", "rawvideo", "pipe:1"
  ]);
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return Buffer.concat(output);
}

// A tile only moves pixels: all low bits and alpha words must survive unchanged.
for (const format of ["rgb48le", "rgb48be", "rgba64le", "rgba64be"]) {
  const channels = format.startsWith("rgba") ? 4 : 3;
  const rowBytes = 2 * channels * 2;
  const input = Buffer.from(Array.from({ length: rowBytes * 4 }, (_, i) => (53 * i + 39) % 256));
  const rows = Array.from({ length: 4 }, (_, i) => input.subarray(i * rowBytes, (i + 1) * rowBytes));
  const sheet = Buffer.concat([rows[0]!, rows[2]!, rows[1]!, rows[3]!]);
  it(`preserves ${format} words without filtering`, async () => {
    assert.deepEqual(await run(input, "null", format), input);
  });
  it(`preserves ${format} words in a horizontal tile sheet`, async () => {
    assert.deepEqual(await run(input, "tile=2x1", format), sheet);
  });
  it(`preserves ${format} words in a vertical tile sheet`, async () => {
    assert.deepEqual(await run(input, "tile=1x2", format), input);
  });
  it(`preserves ${format} words when tile output changes byte order`, async () => {
    const outputFormat = format.slice(0, -2) + (format.endsWith("le") ? "be" : "le");
    assert.deepEqual(await run(input, "tile=2x1", format, outputFormat), Buffer.from(sheet).swap16());
  });
  it(`preserves ${format} with colored borders and empty cells`, async () => {
    const expected = Buffer.alloc(7 * 7 * channels * 2);
    // FFmpeg expands each 8-bit fill component to 16 bits by repeating the byte.
    for (let i = 0; i < 49; i++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = [0x1212, 0x3434, 0x5656, 0x7878][channel]!;
        if (format.endsWith("le")) expected.writeUInt16LE(value, (i * channels + channel) * 2);
        else expected.writeUInt16BE(value, (i * channels + channel) * 2);
      }
    }
    for (const [row, pixel] of [[0, 8], [1, 15], [2, 11], [3, 18]] as const) {
      expected.set(rows[row]!, pixel * channels * 2);
    }
    assert.deepEqual(await run(input, "tile=2x2:margin=1:padding=1:color=0x12345678", format), expected);
  });
  it(`preserves ${format} across overlapping sheets and initial padding`, async () => {
    const blank = Buffer.alloc(rowBytes);
    if (channels === 4) {
      for (let pixel = 0; pixel < 2; pixel++) blank.fill(255, pixel * 8 + 6, pixel * 8 + 8);
    }
    const first = Buffer.concat([blank, rows[0]!, blank, rows[1]!]);
    assert.deepEqual(await run(input, "tile=2x1:overlap=1:init_padding=1", format), Buffer.concat([first, sheet]));
  });
  it(`renders ${format} tiles for downstream RGB processing`, async () => {
    assert.deepEqual(await run(input, "tile=1x1,format=rgba,negate", format, "rgba"),
      await run(input, "format=rgba,negate", format, "rgba"));
  });
  it(`does not reuse stale ${format} samples after RGB processing`, async () => {
    assert.deepEqual(await run(input, "format=rgba,negate,tile=1x1", format),
      await run(input, "format=rgba,negate", format));
  });
}
