import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format = "yuv444p", raw = false) {
  const volume = Volume.fromJSON({ "/in": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(raw ? ["-f", "rawvideo", "-pixel_format", format,
      "-video_size", "2x2", "-framerate", "4"] : []), "-i", "/in", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out") as Buffer;
}

const frames = [[50, 30, 212], [120, 180, 60], [80, 140, 190]]
  .map(frame => Buffer.from(frame.flatMap(value => Array<number>(4).fill(value))));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);

for (const filter of ["null", "pad=iw:ih", "pad=4:4:1:1,crop=2:2:1:1"]) {
  it(`preserves exact Y4M samples with ${filter}`, async () => {
    assert.deepEqual(await run(input, filter), Buffer.concat(frames));
  });
}

it("matches native FFmpeg 7.0.2 YUV samples and red padding", async () => {
  const output = await run(input, "pad=4:4:1:1:red");
  assert.equal(output.length, 144);
  assert.equal(createHash("sha256").update(output).digest("hex"),
    "279524821715111c9463199a0f4f48da93358a0925c77336963484f7847478aa");
});

for (const [format, chroma] of [["yuv444p", [30, 31, 32, 33, 212, 213, 214, 215]],
  ["yuv422p", [30, 31, 212, 213]], ["yuv420p", [30, 212]]] as const) {
  it(`preserves nonuniform ${format} samples through aligned padding and cropping`, async () => {
    const pixels = Buffer.from([50, 51, 52, 53, ...chroma]);
    for (const filter of ["pad=iw:ih", "pad=6:6:2:2:red,crop=2:2:2:2"]) {
      assert.deepEqual(await run(pixels, filter, format, true), pixels);
    }
  });
}

for (const depth of [10, 16]) {
  it(`preserves ${depth}-bit YUV samples and fills the border at native depth`, async () => {
    const pixels = Buffer.alloc(24);
    for (let i = 0; i < 12; i++) pixels.writeUInt16LE((129 + i * 40) << (depth - 10), i * 2);
    const source = Buffer.concat([Buffer.from(`YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444p${depth}\nFRAME\n`), pixels]);
    assert.deepEqual(await run(source, "pad=iw:ih", `yuv444p${depth}le`), pixels);
    const output = await run(source, "pad=4:4:1:1", `yuv444p${depth}le`);
    assert.equal(output.length, 96);
    for (let plane = 0; plane < 3; plane++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const expected = x >= 1 && x <= 2 && y >= 1 && y <= 2
        ? pixels.readUInt16LE((plane * 4 + (y - 1) * 2 + x - 1) * 2)
        : Math.round((plane === 0 ? 16 : 128) * (2 ** depth - 1) / 255);
      assert.equal(output.readUInt16LE((plane * 16 + y * 4 + x) * 2), expected);
    }
  });
}

it("preserves packed RGBA samples and alpha", async () => {
  const pixels = Buffer.from([50, 30, 212, 255, 120, 180, 60, 128, 80, 140, 190, 64, 18, 47, 199, 0]);
  for (const filter of ["pad=iw:ih", "pad=4:4:1:1:red,crop=2:2:1:1"]) {
    assert.deepEqual(await run(pixels, filter, "rgba", true), pixels);
  }
});

it("renders padded YUV for RGB filters without reviving stale native planes", async () => {
  const original = await run(input, "crop=iw:ih,format=rgba", "rgba");
  const output = await run(input, "pad=4:4:1:1,crop=2:2:1:1,format=rgba", "rgba");
  assert.deepEqual(output, original);
  assert.deepEqual(await run(input, "negate,pad=4:4:1:1,crop=2:2:1:1"), await run(input, "negate"));
  assert.deepEqual(await run(input, "format=rgba,negate,pad=4:4:1:1,crop=2:2:1:1"),
    await run(input, "format=rgba,negate"));
});

for (const [format, samples, width, size] of [
  ["yuv420p", 6, 6, 54], ["yuv422p", 8, 6, 84], ["yuv444p", 12, 7, 147]
] as const) {
  it(`uses requested pad dimensions in ${format} position expressions before chroma alignment`, async () => {
    const pixels = Buffer.from(Array.from({ length: samples }, (_, i) => 13 + 7 * i));
    const expected = await run(pixels, "pad=7:7:2:2", format, true);
    assert.equal(expected.length, size);
    assert.deepEqual(expected.subarray(0, width * 2), Buffer.alloc(width * 2, 16));
    assert.deepEqual(expected.subarray(width * 2 + 2, width * 2 + 4), pixels.subarray(0, 2));
    for (const filter of [
      "pad=7:7:ow-5:oh-5",
      "pad=w=7:h=7:x=out_w-5:y=out_h-5",
      "pad=oh:7:ow-5:oh-5",
      "pad=7:ow:ow-5:oh-5"
    ]) {
      assert.deepEqual(await run(pixels, filter, format, true), expected, filter);
    }
  });
}
