import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format = "yuv444p", size = "2x2", y4m = false) {
  const volume = Volume.fromJSON({ "/in": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...(y4m ? [] : ["-f", "rawvideo", "-pix_fmt", format, "-s", size, "-r", "5"]),
      "-i", "/in", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "/out"],
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

for (const [name, frames, hash] of [
  ["chroma", [[50, 30, 212], [50, 79, 181], [50, 128, 150], [50, 177, 119], [50, 226, 88], [50, 45, 57], [50, 94, 26]],
    "3167204dbfcb438cc09b793c5923c6a5686f1d4802516acd05232d332a35131c"],
  ["gray", [20, 90, 90, 185, 45, 45, 140].map(y => [y, 128, 128]),
    "8e2747c1c2adfc97c7fa00205ccff38ee39a30a3dfd1fb15794db8bac84a45c0"],
  ["black and white", [16, 235, 16, 235, 235, 16, 235].map(y => [y, 128, 128]),
    "a30dcc48f6f88e4e735fa8fcf8906d92f28bb60081a61a0a2c8a1e0b098b514d"]
] as const) {
  for (const filter of ["null", "tile=1x1"]) {
    it(`preserves ${name} Y4M samples with ${filter}`, async () => {
      const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame.flatMap(v => Array<number>(4).fill(v)))])]);
      const output = await run(input, filter, "yuv444p", "2x2", true);
      assert.equal(output.length, 84);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

for (const [format, hsub, vsub] of [["yuv444p", 1, 1], ["yuv422p", 2, 1], ["yuv420p", 2, 2]] as const) {
  it(`copies ${format} planes into a grid with margins, padding and a partial last sheet`, async () => {
    const frames = Array.from({ length: 5 }, (_, frame) => [
      Buffer.from([20 + frame, 50 + frame, 90 + frame, 180 + frame]),
      Buffer.from(Array.from({ length: 4 / hsub / vsub }, (_, pixel) => 30 + frame * 20 + pixel)),
      Buffer.from(Array.from({ length: 4 / hsub / vsub }, (_, pixel) => 210 - frame * 20 - pixel))
    ]);
    const output = await run(Buffer.concat(frames.flat()), "tile=2x2:margin=2:padding=2", format);
    const expected: number[] = [];
    for (let sheet = 0; sheet < 2; sheet++) {
      for (let plane = 0; plane < 3; plane++) {
        const sx = plane === 0 ? 1 : hsub;
        const sy = plane === 0 ? 1 : vsub;
        for (let y = 0; y < 10 / sy; y++) {
          for (let x = 0; x < 10 / sx; x++) {
            const col = Math.floor((x * sx - 2) / 4);
            const row = Math.floor((y * sy - 2) / 4);
            const px = x - (2 + col * 4) / sx;
            const py = y - (2 + row * 4) / sy;
            const frame = frames[sheet * 4 + row * 2 + col];
            expected.push(col >= 0 && col < 2 && row >= 0 && row < 2 && px < 2 / sx && py < 2 / sy && frame
              ? frame[plane]![py * (2 / sx) + px]! : plane === 0 ? 16 : 128);
          }
        }
      }
    }
    assert.deepEqual(output, Buffer.from(expected));
  });
}

// Native Linux FFmpeg 7.0.2; odd-sized planes and unaligned red borders.
for (const [format, sx, sy, hash] of [
  ["yuv444p", 1, 1, "2cdac8093b25e0826cfb6f063e3f2586f3d9a8b68e673fb6c7fd81064abf1f09"],
  ["yuv422p", 2, 1, "ba85a87f74a8084019c7d009bf1145104f6b39df3eaabb8d11ae6a571de3e223"],
  ["yuv420p", 2, 2, "a11eb8422a7bc0a463e771e6cf97f63f9bc44cba2db706f7b8ad413dbd5aa8aa"]
] as const) {
  it(`matches native ${format} tiling with odd dimensions and colored borders`, async () => {
    const input = Buffer.from(Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, p) =>
      Array.from({ length: p === 0 ? 9 : Math.ceil(3 / sx) * Math.ceil(3 / sy) }, (_, j) => 20 + i * 20 + p * 40 + j))).flat(2));
    const output = await run(input, "tile=2x2:margin=1:padding=1:color=red", format, "3x3");
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const depth of [10, 16]) {
  it(`preserves ${depth}-bit Y4M samples when tiling`, async () => {
    const payload = Buffer.alloc(24);
    for (let i = 0; i < 12; i++) payload.writeUInt16LE((129 + i * 40) << (depth - 10), i * 2);
    const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444p${depth}\nFRAME\n`), payload]);
    assert.deepEqual(await run(input, "tile=1x1", `yuv444p${depth}le`, "2x2", true), payload);
  });
}

it("renders tiled native planes for downstream RGB filters", async () => {
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\nFRAME\n"),
    Buffer.from([50, 30, 212].flatMap(v => Array<number>(4).fill(v)))]);
  const output = await run(input, "tile=1x1,format=rgba", "rgba", "2x2", true);
  assert.deepEqual(output, Buffer.from("ae0a00ffae0a00ffae0a00ffae0a00ff", "hex"));
});

it("does not resurrect source planes after an RGB filter changes the image", async () => {
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\nFRAME\n"),
    Buffer.from([50, 30, 212].flatMap(v => Array<number>(4).fill(v)))]);
  const filter = "format=rgba,negate";
  assert.deepEqual(await run(input, `${filter},tile=1x1`, "yuv444p", "2x2", true),
    await run(input, filter, "yuv444p", "2x2", true));
});

it("retains YUV samples in overlapping sheets with initial and final blank cells", async () => {
  const frames = Array.from({ length: 7 }, (_, i) => [50, 30 + i * 20, 212 - i * 20]);
  const input = Buffer.from(frames.flatMap(frame => frame.flatMap(v => Array<number>(4).fill(v))));
  const output = await run(input, "tile=3x1:overlap=1:init_padding=1");
  const blank = [16, 128, 128];
  const sheets = [[blank, frames[0]!, frames[1]!], [frames[1]!, frames[2]!, frames[3]!],
    [frames[3]!, frames[4]!, frames[5]!], [frames[5]!, frames[6]!, blank]];
  const expected = sheets.flatMap(sheet => [0, 1, 2].flatMap(plane =>
    [0, 1].flatMap(() => sheet.flatMap(frame => [frame[plane]!, frame[plane]!]))));
  assert.deepEqual(output, Buffer.from(expected));
});

// Native Linux FFmpeg 7.0.2: tile fill uses the full 10-bit sample range,
// while occupied cells retain their original limited-range YUV samples.
for (const [filter, hex] of [
  ["tile=2x1", "400040004000400040004000400040000002020200020202"],
  ["tile=2x1:color=red", "4000400047014701400040004701470100026a010002c303"],
  ["tile=1x1", "400040004000400000020002"]
] as const) {
  it(`matches native 10-bit YUV420 tile fill with ${filter}`, async () => {
    const input = Buffer.from("400040004000400000020002", "hex");
    assert.deepEqual(await run(input, filter, "yuv420p10le"), Buffer.from(hex, "hex"));
  });
}
