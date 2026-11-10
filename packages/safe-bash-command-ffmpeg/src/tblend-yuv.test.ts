import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format = "yuv444p") {
  const volume = Volume.fromJSON({ "/in.y4m": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
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

const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]];
const planes = (frames: number[][]) => Buffer.from(frames.flatMap(frame => frame.flatMap(value => Array<number>(4).fill(value))));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"), planes([frame])])]);

// Linux FFmpeg 7.0.2 reference output, including the repeated pair at t=0.5.
for (const [filter, expected] of [
  ["null", planes(samples)],
  ["tblend=c0_mode=difference", planes([[70, 180, 60], [0, 180, 60], [40, 140, 190]])],
  ["tblend=c1_mode=difference", planes([[120, 150, 60], [120, 0, 60], [80, 40, 190]])],
  ["tblend=difference", planes([[70, 180, 60], [0, 180, 60], [40, 140, 190]])],
  ["tblend=c2_mode=difference", planes([[120, 180, 152], [120, 180, 0], [80, 140, 130]])],
  ["tblend=c0_mode=6:c1_mode=average:c2_mode=addition", planes([[70, 105, 255], [0, 180, 120], [40, 160, 250]])],
  ["tblend=c0_mode=difference:all_mode=normal", planes(samples.slice(1))],
  ["tblend=all_mode=difference", Buffer.from("464646469696969698989898000000000000000000000000282828282828282882828282", "hex")],
  ["tblend=all_mode=difference,select='eq(t,0.5)'", Buffer.alloc(12)],
  ["trim=end_frame=1,tblend=all_mode=difference", Buffer.alloc(0)],
  ["tblend=all_mode=difference,tblend=all_mode=difference", planes([[70, 150, 152], [40, 40, 130]])]
] as const) {
  it(`computes YUV plane differences and retains timing for ${filter}`, async () => {
    assert.deepEqual(await run(input, filter), expected);
  });
}

for (const [chroma, format, sx, sy, depth] of [
  ["444", "yuv444p", 1, 1, 8],
  ["422", "yuv422p", 2, 1, 8],
  ["420", "yuv420p", 2, 2, 8],
  ["444p10", "yuv444p10le", 1, 1, 10],
  ["444p16", "yuv444p16le", 1, 1, 16]
] as const) {
  it(`subtracts individual ${format} samples with odd plane dimensions`, async () => {
    const size = 9 + 2 * Math.ceil(3 / sx) * Math.ceil(3 / sy);
    const first = Array.from({ length: size }, (_, i) => ((i * 31 + 15) * 257) % (2 ** depth));
    const second = Array.from({ length: size }, (_, i) => ((i * 79 + 240) * 257) % (2 ** depth));
    const encode = (values: number[]) => {
      if (depth === 8) return Buffer.from(values);
      const bytes = Buffer.alloc(values.length * 2);
      values.forEach((value, i) => bytes.writeUInt16LE(value, i * 2));
      return bytes;
    };
    const source = Buffer.concat([Buffer.from(`YUV4MPEG2 W3 H3 F4:1 Ip A1:1 C${chroma}\nFRAME\n`),
      encode(first), Buffer.from("FRAME\n"), encode(second)]);
    assert.deepEqual(await run(source, "tblend=all_mode=difference", format),
      encode(first.map((value, i) => Math.abs(value - second[i]!))));
    const chromaSize = Math.ceil(3 / sx) * Math.ceil(3 / sy);
    assert.deepEqual(await run(source, "tblend=c1_mode=difference", format),
      encode(second.map((value, i) => i >= 9 && i < 9 + chromaSize ? Math.abs(value - first[i]!) : value)));
  });
}

it("renders differenced YUV planes for downstream RGB filters", async () => {
  const difference = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...[[70, 150, 152], [0, 0, 0], [40, 40, 130]].flatMap(frame => [Buffer.from("FRAME\n"), planes([frame])])]);
  assert.deepEqual(await run(input, "tblend=all_mode=difference,format=rgba,negate", "rgba"),
    await run(difference, "tile=1x1,format=rgba,negate", "rgba"));
});

it("uses current RGB pixels after a prior filter invalidates the source planes", async () => {
  const actual = await run(input, "format=rgba,negate,tblend=all_mode=difference", "rgba");
  const rgb = await run(input, "format=rgba,negate", "rgba");
  assert.equal(actual.length, 3 * 16);
  for (let i = 0; i < actual.length; i++) {
    if (i % 4 !== 3) assert.equal(actual[i], Math.abs(rgb[i + 16]! - rgb[i]!));
  }
});
