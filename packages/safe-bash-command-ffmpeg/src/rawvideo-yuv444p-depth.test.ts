import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const gray = [16, 17, 18, 30, 90, 235].map(y => [y, 128, 128]);
const color = [[55, 80, 172], [55, 180, 60], [122, 62, 72], [230, 20, 230], [60, 120, 100], [80, 176, 90]];

async function run(frames: number[][], format: string, maxOutputBytes = 144) {
  const volume = Volume.fromJSON({
    "/in.y4m": Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...frames.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.map(value => Buffer.alloc(4, value))])
    ]),
    "/out.raw": "KEEP"
  });
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", "null", "-fps_mode", "passthrough",
      "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const depth of [8, 10, 16]) {
  const format = depth === 8 ? "yuv444p" : `yuv444p${depth}le`;
  for (const [name, frames] of [["gray", gray], ["color", color], ["constant", gray.map(() => [64, 128, 128])]] as const) {
    it(`writes all six ${name} frames as ${format} with exact planar samples`, async () => {
      const result = await run(frames, format);
      assert.equal(result.exitCode, 0, result.stderr);
      // FFmpeg expands 8-bit planar samples by 4 for 10-bit and 256 for 16-bit.
      const expected = frames.flatMap(frame => frame.flatMap(value => Array<number>(4).fill(value * 2 ** (depth - 8))));
      assert.equal(result.output.length, depth === 8 ? 72 : 144);
      const actual = depth === 8 ? [...result.output]
        : Array.from({ length: 72 }, (_, index) => result.output.readUInt16LE(index * 2));
      assert.deepEqual(actual, expected);
    });
  }
  it(`enforces cumulative ${format} output limits before replacing the destination`, async () => {
    const result = await run(gray, format, depth === 8 ? 71 : 143);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /maxOutputBytes/);
    assert.equal(result.output.toString(), "KEEP");
  });
}
