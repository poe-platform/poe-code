import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, format: string, filter: string, graph = false, outputFormat = format) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "4x2", "-framerate", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-frames:v", "1", "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"],
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
  assert.equal(stderr, "");
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return Buffer.concat(output);
}

// Full raw-frame outputs from native FFmpeg 7.0.2, including untouched channels.
const rgb = "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e19242f3a45505b66717c87929da8b3bec9d4dfeaf5000b16";
for (const [filter, expected] of [
  ["null", rgb],
  ["lutrgb=r=val", rgb],
  ["lutrgb=r=negval:enable=0", rgb],
  ["lutrgb=r=w+h", "060027323d48060069747f8a0600abb6c1cc0600edf8030e06002f3a45500600717c87920600b3bec9d40600f5000b16"],
  ["lutrgb=r=negval", "eee327323d48aca169747f8a6a5fabb6c1cc281dedf8030ee6db2f3a4550a499717c87926257b3bec9d42015f5000b16"]
]) {
  for (const format of ["rgb48le", "rgb48be"]) {
    for (const graph of [false, true]) {
      it(`preserves ${format} precision with ${filter} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.from(rgb, "hex");
        const output = Buffer.from(expected!, "hex");
        if (format.endsWith("be")) { input.swap16(); output.swap16(); }
        assert.deepEqual(await run(input, format, filter!, graph), output);
      });
    }
  }
}

for (const format of ["rgba64le", "rgba64be"]) {
  it(`handles full-range ${format} channel arithmetic, clipping, and alpha`, async () => {
    const input = Buffer.alloc(64);
    const expected = Buffer.alloc(64);
    const values = [0, 1, 255, 256, 32767, 32768, 65534, 65535];
    for (const [pixel, value] of values.entries()) {
      for (let channel = 0; channel < 4; channel++) input.writeUInt16LE(value, pixel * 8 + channel * 2);
      expected.writeUInt16LE(65535 - value, pixel * 8);
      expected.writeUInt16LE(Math.min(65535, value * 2), pixel * 8 + 2);
      expected.writeUInt16LE(0, pixel * 8 + 4);
      expected.writeUInt16LE(Math.trunc(value / 2), pixel * 8 + 6);
    }
    if (format.endsWith("be")) { input.swap16(); expected.swap16(); }
    assert.deepEqual(await run(input, format, "lutrgb=r=negval:g=clipval*2:b=minval:a=val/2"), expected);
  });
}

it("retains low bits through chained lookups and output byte-order conversion", async () => {
  const input = Buffer.from(rgb, "hex");
  assert.deepEqual(await run(input, "rgb48le", "lutrgb=r=negval,lutrgb=r=negval", false, "rgb48be"),
    Buffer.from(input).swap16());
});

it("keeps 8-bit RGB identity samples exact", async () => {
  const input = Buffer.from(rgb.slice(0, 48), "hex");
  assert.deepEqual(await run(input, "rgb24", "lutrgb=r=val"), input);
});
