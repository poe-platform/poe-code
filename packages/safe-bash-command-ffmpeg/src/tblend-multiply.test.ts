import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, filter: string, format = "yuv444p", inputArgs = ["-i", "/in"]) {
  const volume = Volume.fromJSON({ "/in": Buffer.from(input), "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...inputArgs, "-vf", filter,
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
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]];
const planes = (frames: number[][]) => Buffer.from(frames.flatMap(frame => frame.flatMap(value => Array<number>(4).fill(value))));
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"), planes([frame])])]);

// FFmpeg 7.0.2 reference: truncate sample products divided by 255, keeping three frames.
for (const [filter, expected] of [
  ["null", planes(samples)],
  ["tblend=all_mode=multiply", Buffer.from("171717171515151531313131383838387f7f7f7f0e0e0e0e25252525626262622c2c2c2c", "hex")],
  ["tblend=all_mode=13", planes([[23, 21, 49], [56, 127, 14], [37, 98, 44]])],
  ["tblend=all_mode=multiply+0", planes([[23, 21, 49], [56, 127, 14], [37, 98, 44]])],
  ["sendcmd=c='0.5 tblend all_mode multiply',tblend=all_mode=difference", planes([[70, 150, 152], [56, 127, 14], [37, 98, 44]])],
  ["tblend=all_mode=multiply,select='eq(t,0.5)'", planes([[56, 127, 14]])],
  ["trim=end_frame=1,tblend=all_mode=multiply", Buffer.alloc(0)],
  ["tblend=all_mode=multiply,tblend=all_mode=multiply", planes([[5, 10, 2], [8, 48, 2]])]
] as const) {
  it(`multiplies successive YUV frames and retains timestamps for ${filter}`, async () => {
    const result = await run(input, filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, expected);
  });
}

for (const [chroma, format, depth, count] of [
  ["420", "yuv420p", 8, 17],
  ["422", "yuv422p", 8, 21],
  ["444", "yuv444p", 8, 27],
  ["444p10", "yuv444p10le", 10, 27],
  ["444p16", "yuv444p16le", 16, 27]
] as const) {
  it(`normalizes ${format} samples without rounding or overflowing`, async () => {
    const max = 2 ** depth - 1;
    const first = Array.from({ length: count }, (_, i) => [max, 0, max - 1, Math.floor(max / 2)][i % 4]!);
    const second = Array.from({ length: count }, (_, i) => [max, max, max - 2, Math.floor(max / 2)][i % 4]!);
    const encode = (values: number[]) => {
      if (depth === 8) return Buffer.from(values);
      const bytes = Buffer.alloc(values.length * 2);
      values.forEach((value, i) => bytes.writeUInt16LE(value, i * 2));
      return bytes;
    };
    const source = Buffer.concat([Buffer.from(`YUV4MPEG2 W3 H3 F4:1 Ip A1:1 C${chroma}\nFRAME\n`),
      encode(first), Buffer.from("FRAME\n"), encode(second)]);
    const result = await run(source, "tblend=all_mode=multiply", format);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, encode(first.map((value, i) => Math.floor(value * second[i]! / max))));
  });
}

it("renders multiplied planes for subsequent RGB filters", async () => {
  const multiplied = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
    ...[[23, 21, 49], [56, 127, 14], [37, 98, 44]].flatMap(frame => [Buffer.from("FRAME\n"), planes([frame])])]);
  const actual = await run(input, "tblend=all_mode=multiply,format=rgba,negate", "rgba");
  const expected = await run(multiplied, "tile=1x1,format=rgba,negate", "rgba");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(expected.exitCode, 0, expected.stderr);
  assert.deepEqual(actual.output, expected.output);
});

it("multiplies RGB and alpha samples", async () => {
  const source = Buffer.from([50, 30, 212, 255, 120, 180, 60, 128, 80, 140, 190, 32]);
  const result = await run(source, "tblend=all_mode=multiply", "rgba",
    ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "1x1", "-framerate", "4", "-i", "/in"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.from([23, 21, 49, 129, 37, 98, 44, 16]));
});

it("uses current RGB samples after a filter invalidates native YUV planes", async () => {
  const actual = await run(input, "format=rgba,negate,tblend=all_mode=multiply", "rgba");
  const rgb = await run(input, "format=rgba,negate", "rgba");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(rgb.exitCode, 0, rgb.stderr);
  const expected = Buffer.from(Array.from({ length: 48 }, (_, i) => Math.floor(rgb.output[i]! * rgb.output[i + 16]! / 255)));
  assert.deepEqual(actual.output, expected);
});

it("rejects unsupported multiply options before replacing the destination", async () => {
  const result = await run(input, "tblend=all_mode=multiply:all_opacity=1.5");
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("tblend:"), result.stderr);
  assert.equal(result.output.toString(), "KEEP");
});
