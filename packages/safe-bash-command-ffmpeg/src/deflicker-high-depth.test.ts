import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, filter: string) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
      "-framerate", "2", "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return Buffer.concat(chunks);
}

// Byte-for-byte references from FFmpeg 7.0.2-static, including the untouched chroma planes.
for (const [format, inputHex, correctedHex] of [
  ["yuv444p10le",
    "1100940017019a011d02a0022303a6032900ac002f01b2013502b8023b03be034100c4004701ca014d02d0025303d6035900dc005f01e2016502e8026b03ee037100f4007701fa01",
    "260051017d02a8031d02a0022303a6032900ac002f01b2018401de01380292024100c4004701ca014d02d0025303d6035900dc005f01e2016502e8026b03ee037100f4007701fa01"],
  ["yuv444p16le",
    "114477aadd104376a9dc0f4275a8db0e4174a7da0d4073a6d90c3f72a5d80b3e71a4d70a3d70a3d6093c6fa2d5083b6ea1d4073a6da0d306396c9fd205386b9ed104376a9dd00336",
    "fe46cab19611587ba9dc0f4275a8db0e4174a7da0d4073a65b0dc47638e17f4071a4d70a3d70a3d6093c6fa2d5083b6ea1d4073a6da0d306396c9fd205386b9ed104376a9dd00336"]
]) {
  for (const filter of ["deflicker=s=2", "deflicker=s=2:bypass=1", "null"]) {
    it(`matches native ${format} bytes for ${filter}`, async () => {
      const input = Buffer.from(inputHex!, "hex");
      const output = await run(input, format!, filter);
      assert.deepEqual(output, filter === "deflicker=s=2" ? Buffer.from(correctedHex!, "hex") : input);
    });
  }
}

it("preserves the native gray16le correction control", async () => {
  const output = await run(Buffer.from("114477aadd104376a9dc0f4275a8db0e4174a7da0d4073a6", "hex"), "gray16le", "deflicker=s=2");
  assert.equal(output.toString("hex"), "d84c72c0091383850cf3c2488cb95c104174a7da0d4073a6");
});

it("clips corrected 10-bit luma at 1023 while retaining full chroma precision", async () => {
  const values = [100, 100, 100, 1023, 17, 300, 511, 999, 21, 401, 700, 1023,
    1023, 1023, 1023, 1023, 13, 200, 800, 1000, 27, 403, 901, 1022];
  const input = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => input.writeUInt16LE(value, index * 2));
  const expected = Buffer.from(input);
  for (let index = 0; index < 3; index++) expected.writeUInt16LE(204, index * 2);
  assert.deepEqual(await run(input, "yuv444p10le", "deflicker=s=2"), expected);
});
