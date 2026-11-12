import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 1, 257, 258, 32767, 32768, 33001, 45032, 65279, 65533, 65534, 65535];

async function run(codec: string, values: number[], maximum: number, args: string[], source = "file",
  limits: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const raster = maximum > 255 ? Buffer.alloc(values.length * 2) : Buffer.from(values);
  if (maximum > 255) values.forEach((value, index) => raster.writeUInt16BE(value, index * 2));
  const input = Buffer.concat([Buffer.from(`${codec === "ppm" ? "P6" : "P5"}\n# precision\n2 2\n${maximum}\n`), raster]);
  const volume = Volume.fromJSON({ [`/in.${codec}`]: input, [`/in1.${codec}`]: input, [`/in2.${codec}`]: input, "/image.bin": input });
  const pipe = source === "pipe";
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand(limits).execute({
    args: ["-v", "error", ...(pipe ? ["-f", "image2pipe", "-c:v", codec] : []),
      "-i", pipe ? "pipe:0" : source === "sequence" ? `/in%d.${codec}` : source === "detected" ? "/image.bin" : `/in.${codec}`, ...args, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () { yield input; yield input; })(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: Buffer.concat(output), raster };
}

for (const codec of ["ppm", "pgm"]) {
  for (const source of ["file", "pipe", "sequence", "detected"]) {
    for (const endian of ["be", "le", "default"]) {
      it(`preserves all ${codec} 16-bit samples (${endian}, ${source})`, async () => {
        const format = `${codec === "ppm" ? "rgb48" : "gray16"}${endian}`;
        const result = await run(codec, codec === "ppm" ? samples : samples.slice(0, 4), 65535,
          ["-vf", "null", ...(endian === "default" ? [] : ["-pix_fmt", format])], source);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        const expected = endian === "le" ? Buffer.from(result.raster).swap16() : result.raster;
        assert.deepEqual(result.output, source === "pipe" || source === "sequence" ? Buffer.concat([expected, expected]) : expected);
      });
    }
  }
}

// Native FFmpeg 7.0.2, P6 2x2 raster with sample i = floor(i * MAXVAL / 11).
for (const [maximum, expected] of [[255, "00172e455c738ba2b9d0e7ff"], [1023, "00172f465d748ca3bad1e9ff"]] as const) {
  it(`matches native PPM MAXVAL ${maximum} conversion to rgb24`, async () => {
    const result = await run("ppm", samples.map((_, i) => Math.floor(i * maximum / 11)), maximum, ["-pix_fmt", "rgb24"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

it("enforces rawvideo output limits before writing high-depth PPM samples", async () => {
  const result = await run("ppm", samples, 65535, ["-pix_fmt", "rgb48be"], "file", { limits: { maxOutputBytes: 23 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.length, 0);
});
