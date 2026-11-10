import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function select(input: Buffer, filter: string, pixelFormat = "yuv444p", graph = false, inputOptions: string[] = []): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...inputOptions, "-i", "/in.y4m",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", pixelFormat, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  return volume.readFileSync("/out.raw") as Buffer;
}

const levels = [16, 235, 16, 235, 235, 16, 235];
const frames = levels.map(y => Buffer.from([y, y, y, y, 128, 128, 128, 128, 128, 128, 128, 128]));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);

// Native FFmpeg 7.0.2 reference bytes: history includes rejected frames.
for (const [expression, indices, hash] of [
  ["gt(scene\\,0.15)", [1, 5], "524f3fe701676b5f6e0d209f2ed2239aa71cd706335ded94c8e2b169a2d831fc"],
  ["eq(scene\\,0)", [0, 2, 3, 4, 6], "4f24d5c7d912a5bcba3560c4dcfc6d63f784f9a5a5e32febf7658988778b743d"],
  ["eq(n\\,0)", [0], "800edfea8432478a44906f59283ae071730dc6320848b7674444ac2027d312ea"],
  ["gt(t\\,0.4)", [3, 4, 5, 6], "32646085117cc12ac585a9b516549adda55fa34e876246048fcca6aae09f09a1"]
] as const) {
  it(`matches native select=${expression}`, async () => {
    const output = await select(input, `select=${expression}`);
    assert.deepEqual(output, Buffer.concat(indices.map(i => frames[i]!)));
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

it("keeps scene history separate for chained select filters and mapped graphs", async () => {
  const output = await select(input, "select=gt(scene\\,0.15),select=eq(scene\\,0)", "yuv444p", true);
  assert.deepEqual(output, frames[1]);
});

it("ignores chroma changes when scoring planar YUV", async () => {
  const chromaFrames = [16, 235, 16].map(u => Buffer.from([100, 100, 100, 100, u, u, u, u, 128, 128, 128, 128]));
  const clip = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
    ...chromaFrames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
  assert.deepEqual(await select(clip, "select=eq(scene\\,0)"), Buffer.concat(chromaFrames));
});

for (const depth of [8, 10, 16]) {
  it(`uses native luma precision and float score thresholds for ${depth}-bit video`, async () => {
    const payloads = [16, 32, 64, 64].map(y => {
      const bytes = Buffer.alloc(12 * (depth === 8 ? 1 : 2));
      for (let i = 0; i < 12; i++) {
        const value = (i < 4 ? y : 128) * 2 ** (depth - 8);
        if (depth === 8) bytes[i] = value;
        else bytes.writeUInt16LE(value, i * 2);
      }
      return bytes;
    });
    const clip = Buffer.concat([Buffer.from(`YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444${depth === 8 ? "" : `p${depth}`}\n`),
      ...payloads.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
    const format = depth === 8 ? "yuv444p" : `yuv444p${depth}le`;
    assert.deepEqual(await select(clip, "select=gt(scene\\,0.159)", format), Buffer.concat(payloads.slice(1, 3)));
    // Native av_clipf rounds 0.16 down to float32 before expression evaluation.
    assert.deepEqual(await select(clip, "select=lt(scene\\,0.16)", format), Buffer.concat(payloads));
  });
}

for (const format of ["gray", "ya8", "rgb24", "rgba", "gray16be", "rgb48be", "rgba64be"]) {
  it(`scores the stored components of ${format} frames`, async () => {
    const depth = format.endsWith("be") ? 16 : 8;
    const components = format === "ya8" ? 2 : format.startsWith("gray") ? 1 : format.startsWith("rgba") ? 4 : 3;
    const payloads = [0, 60, 60, 120].map(value => {
      const bytes = Buffer.alloc(components * depth / 8);
      for (let i = 0; i < components; i++) {
        if (depth === 16) bytes.writeUInt16BE(value * 256, i * 2);
        else bytes[i] = value;
      }
      return bytes;
    });
    const clip = Buffer.concat(payloads);
    const options = ["-f", "rawvideo", "-pixel_format", format, "-video_size", "1x1", "-framerate", "5"];
    assert.deepEqual(await select(clip, "select=gt(scene\\,0.59)", format, false, options),
      Buffer.concat([payloads[1]!, payloads[3]!]));
  });
}
