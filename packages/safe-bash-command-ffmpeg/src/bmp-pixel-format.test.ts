import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const rgb = Buffer.from(Array.from({ length: 45 }, (_, i) => {
  const pixel = Math.floor(i / 3);
  return (31 * (pixel % 5) + 47 * Math.floor(pixel / 5) + 59 * (i % 3)) % 256;
}));
const rgba = Buffer.from(Array.from({ length: 60 }, (_, i) =>
  i % 4 === 3 ? 17 * Math.floor(i / 4) : rgb[Math.floor(i / 4) * 3 + i % 4]!));

async function run(format: string, target: string, input = rgb, options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.bmp": "keep" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const args = ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", input === rgba ? "rgba" : "rgb24",
    "-video_size", "5x3", "-i", "/in.raw", "-frames:v", "1", "-c:v", "bmp", "-pix_fmt", format,
    "-f", target === "pipe:1" ? "image2pipe" : "image2", target];
  // The synchronous evaluator must defer options it cannot encode faithfully.
  assert.equal(evalSyncFfmpeg(args, undefined, () => input, () => { assert.fail("unexpected synchronous write"); }), undefined);
  const result = await createFfmpegCommand(options).execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  const bytes = target === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(target.replace("%d", "1")) as Buffer;
  return { ...result, stderr, bytes };
}

// FFmpeg 7.0.2 headers for the issue's 5x3 RGB24 fixture.
for (const [format, bits, compression, offset] of [
  ["bgr24", 24, 0, 54], ["bgra", 32, 0, 54],
  ["rgb565le", 16, 3, 66], ["rgb555le", 16, 0, 54], ["rgb444le", 16, 3, 66],
  ["rgb8", 8, 0, 1078], ["bgr8", 8, 0, 1078],
  ["rgb4_byte", 8, 0, 1078], ["bgr4_byte", 8, 0, 1078], ["pal8", 8, 0, 1078], ["monob", 1, 0, 62]
] as const) {
  for (const target of ["pipe:1", "/out.bmp", "/out%d.bmp"]) {
    it(`writes ${format} BMP pixels to ${target}`, async () => {
      const { exitCode, stderr, bytes } = await run(format, target);
      assert.equal(exitCode, 0, stderr);
      assert.equal(bytes.toString("ascii", 0, 2), "BM");
      assert.equal(bytes.readUInt16LE(28), bits);
      assert.equal(bytes.readUInt32LE(30), compression);
      assert.equal(bytes.readUInt32LE(10), offset);
      assert.equal(bytes.readUInt32LE(14), 40);
      assert.equal(bytes.readInt32LE(18), 5);
      assert.equal(bytes.readInt32LE(22), 3);
      const stride = Math.ceil(5 * bits / 32) * 4;
      assert.equal(bytes.length, offset + stride * 3);
      assert.equal(bytes.readUInt32LE(2), bytes.length);
      assert.equal(bytes.readUInt32LE(34), stride * 3);
      if (compression) assert.deepEqual([...Array(3)].map((_, i) => bytes.readUInt32LE(54 + i * 4)),
        format === "rgb565le" ? [0xf800, 0x07e0, 0x001f] : [0x0f00, 0x00f0, 0x000f]);
      if (bits === 24 || bits === 32) {
        for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
          const source = (y * 5 + x) * 3;
          const pixel: number = offset + (2 - y) * stride + x * bits / 8;
          assert.deepEqual([...bytes.subarray(pixel, pixel + bits / 8)],
            [rgb[source + 2], rgb[source + 1], rgb[source], ...(bits === 32 ? [255] : [])]);
        }
      }
      if (bits === 8) {
        const pixels = {
          rgb8: "7396b8bcc10000002e537798bc000000050e4e5397000000",
          bgr8: "e3ac353d4600000099e2eb343d00000048989ae2ec000000",
          pal8: "e3ac353d4600000099e2eb343d00000048989ae2ec000000",
          rgb4_byte: "0d050e0e0800000005030c0c06000000000305050d000000",
          bgr4_byte: "0d0c0707010000000c0a050506000000000a0c0c0d000000"
        };
        assert.equal(bytes.subarray(offset).toString("hex"), pixels[format as keyof typeof pixels]);
        const palettes = {
          rgb8: "8201ceb88cd05a82bb483701c4d6e57b8f3456977421fccc024a8349dc6b89d6",
          bgr8: "2cc4a9b683708c932e679145b125e5862033a984098969e5594b41aefcdca407",
          pal8: "2cc4a9b683708c932e679145b125e5862033a984098969e5594b41aefcdca407",
          rgb4_byte: "a6ab4a1eaea8b9661a2b8df3b92ec97c2436fd3011534e3fef257862b2a1e460",
          bgr4_byte: "399f7ac90d5249f83e652b7a50c250d4cbff19ba691221546e3b08e9f80a4a25"
        };
        const palette = bytes.subarray(54, format.endsWith("4_byte") ? 118 : 1078);
        assert.equal(createHash("sha256").update(palette).digest("hex"), palettes[format as keyof typeof palettes]);
      }
      if (bits === 16) {
        const channelMasks = format === "rgb565le" ? [0xf800, 0x07e0, 0x001f]
          : format === "rgb555le" ? [0x7c00, 0x03e0, 0x001f] : [0x0f00, 0x00f0, 0x000f];
        for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
          const pixel = bytes.readUInt16LE(offset + (2 - y) * stride + x * 2);
          for (let channel = 0; channel < 3; channel++) {
            const mask = channelMasks[channel]!;
            const shift = Math.log2(mask & -mask);
            const maximum = mask >> shift;
            const decoded = ((pixel & mask) >> shift) * 255 / maximum;
            assert.ok(Math.abs(decoded - rgb[(y * 5 + x) * 3 + channel]!) <= 255 / maximum);
          }
        }
      }
      if (format === "monob") {
        assert.equal(bytes.subarray(54, 62).toString("hex"), "00000000ffffff00");
        // Ignore unused row bits: native FFmpeg leaves those unspecified.
        assert.deepEqual([bytes[62]! & 248, bytes[66]! & 248, bytes[70]! & 248], [240, 80, 56]);
      }
    });
  }
}

for (const target of ["pipe:1", "/out.bmp", "/out%d.bmp"]) {
  it(`preserves every BGRA color and alpha byte in ${target}`, async () => {
    const { exitCode, stderr, bytes } = await run("bgra", target, rgba);
    assert.equal(exitCode, 0, stderr);
    const decoded = Buffer.alloc(rgba.length);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
      const source = 54 + ((2 - y) * 5 + x) * 4;
      decoded.set([bytes[source + 2]!, bytes[source + 1]!, bytes[source]!, bytes[source + 3]!], (y * 5 + x) * 4);
    }
    assert.deepEqual(decoded, rgba);
  });
}

it("checks BMP output limits before replacing a file", async () => {
  const result = await run("pal8", "/out.bmp", rgb, { limits: { maxOutputBytes: 1101 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.bytes.toString(), "keep");
});

it("preserves RGBA input in synchronous BMP image sequences", () => {
  const input = Buffer.from("716f696600000002000000010400ff80402080ff1248aaff0000000000000001", "hex");
  const outputs: Uint8Array[] = [];
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.qoi", "/out%d.bmp"], undefined,
    () => input, (_path, bytes) => { outputs.push(bytes); return true; }), "");
  const bmp = Buffer.from(outputs[0]!);
  assert.equal(bmp.readUInt16LE(28), 32);
  assert.equal(bmp.subarray(54).toString("hex"), "20408080aa4812ff");
});
