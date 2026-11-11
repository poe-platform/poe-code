import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, filter: string, complex = false) {
  const volume = Volume.fromJSON({ "/in.gray": input });
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
      "-framerate", "4", "-i", "/in.gray",
      ...(complex ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.deepEqual(volume.readFileSync("/in.gray"), input);
  return Buffer.concat(output);
}

for (const format of ["gray16le", "gray16be"]) {
  const input = Buffer.from("39008c00df0032018501d8012b027e02", "hex");
  if (format === "gray16be") input.swap16();
  for (const [filter, hex] of [
    ["null", "39008c00df0032018501d8012b027e02"],
    ["untile=1x1", "39008c00df0032018501d8012b027e02"],
    ["untile=2x1", "3900df008c00320185012b02d8017e02"],
    ["untile=1x2", "39008c00df0032018501d8012b027e02"],
    ["untile=2x2", "39008c00df0032018501d8012b027e02"]
  ] as const) {
    for (const complex of [false, true]) {
      it(`preserves ${format} words with ${filter} (complex=${complex})`, async () => {
        const expected = Buffer.from(hex, "hex");
        if (format === "gray16be") expected.swap16();
        assert.deepEqual(await run(input, format, filter, complex), expected);
      });
    }
  }

  it(`preserves edited ${format} samples from an upstream negate filter`, async () => {
    const expected = Buffer.from("c6ff20ff73ffcdfe7afed4fd27fe81fd", "hex");
    if (format === "gray16be") expected.swap16();
    assert.deepEqual(await run(input, format, "negate,untile=2x1"), expected);
  });

  it(`does not restore stale ${format} samples after RGB filtering`, async () => {
    const filter = "format=rgba,negate";
    assert.deepEqual(await run(input, format, `${filter},untile=1x1`), await run(input, format, filter));
  });
}
