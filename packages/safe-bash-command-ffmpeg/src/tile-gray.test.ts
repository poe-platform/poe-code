import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, filter: string, format = "gray16le", outputFormat = format) {
  const volume = Volume.fromJSON({ "/in.gray": input });
  const argumentValues = createCommandArguments([
    "-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
    "-framerate", "4", "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough",
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
  assert.deepEqual(volume.readFileSync("/in.gray"), input);
  return Buffer.concat(output);
}

const input = Buffer.from("39008c00df0032018501d8012b027e02", "hex");
const sheet = Buffer.from("39008c008501d801df0032012b027e02", "hex");

for (const format of ["gray16le", "gray16be"]) {
  const bytes = format === "gray16le" ? input : Buffer.from(input).swap16();
  const expected = format === "gray16le" ? sheet : Buffer.from(sheet).swap16();
  it(`preserves the original ${format} words without filtering`, async () => {
    assert.deepEqual(await run(bytes, "null", format), bytes);
  });
  it(`preserves the original ${format} words in a complete tile sheet`, async () => {
    assert.deepEqual(await run(bytes, "tile=2x1", format), expected);
  });
  it(`preserves ${format} words when tile output changes byte order`, async () => {
    assert.deepEqual(await run(bytes, "tile=2x1", format, format === "gray16le" ? "gray16be" : "gray16le"),
      Buffer.from(expected).swap16());
  });
}

for (const format of ["gray16le", "gray16be"]) {
  const bytes = format === "gray16le" ? input : Buffer.from(input).swap16();
  for (const [color, fill] of [["black", 0], ["white", 65535], ["red", 19595]] as const) {
    it(`preserves ${format} samples with ${color} borders and empty cells`, async () => {
      const expected = Buffer.alloc(7 * 7 * 2);
      for (let offset = 0; offset < expected.length; offset += 2) {
        if (format === "gray16le") expected.writeUInt16LE(fill, offset);
        else expected.writeUInt16BE(fill, offset);
      }
      for (const [offset, word] of [[8, 57], [9, 140], [15, 223], [16, 306],
        [11, 389], [12, 472], [18, 555], [19, 638]] as const) {
        if (format === "gray16le") expected.writeUInt16LE(word, offset * 2);
        else expected.writeUInt16BE(word, offset * 2);
      }
      assert.deepEqual(await run(bytes, `tile=2x2:margin=1:padding=1:color=${color}`, format), expected);
    });
  }
  it(`preserves ${format} samples across overlapping sheets and initial padding`, async () => {
    // First sheet: blank, frame 0. Second sheet: frame 0, frame 1.
    const first = Buffer.concat([Buffer.alloc(4), bytes.subarray(0, 4), Buffer.alloc(4), bytes.subarray(4, 8)]);
    const second = format === "gray16le" ? sheet : Buffer.from(sheet).swap16();
    assert.deepEqual(await run(bytes, "tile=2x1:overlap=1:init_padding=1", format), Buffer.concat([first, second]));
  });
  it(`renders ${format} tiles for downstream RGB processing`, async () => {
    assert.deepEqual(await run(bytes, "tile=1x1,format=rgba,negate", format, "rgba"),
      await run(bytes, "format=rgba,negate", format, "rgba"));
  });
  it(`does not reuse stale ${format} samples after RGB processing`, async () => {
    assert.deepEqual(await run(bytes, "format=rgba,negate,tile=1x1", format),
      await run(bytes, "format=rgba,negate", format));
  });
}
