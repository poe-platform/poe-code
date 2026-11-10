import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Uint8Array, args: string[] = [], options: Parameters<typeof createFfmpegCommand>[0] = {}) {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gbrap", "-video_size", "2x2",
      "-framerate", "4", "-i", "/in.raw", ...args, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") };
}

it("decodes four planar GBRAP frames to the native FFmpeg RGBA reference", async () => {
  const samples = [[50, 30, 212, 255], [120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 32]];
  const input = Buffer.from(samples.flatMap(frame => [1, 2, 0, 3].flatMap(channel => Array<number>(4).fill(frame[channel]!))));
  const result = await run(input, ["-vf", "null", "-fps_mode", "passthrough", "-pix_fmt", "rgba"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), "321ed4ff321ed4ff321ed4ff321ed4ff78b43c8078b43c8078b43c8078b43c8078b43c8078b43c8078b43c8078b43c80508cbe20508cbe20508cbe20508cbe20");
});

const planes = Buffer.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 0, 1, 128, 255]);
it("preserves distinct pixels and transparent RGB while ignoring an incomplete final frame", async () => {
  const result = await run(Buffer.concat([planes, planes.subarray(0, 15)]), ["-pix_fmt", "rgba"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.from([90, 10, 50, 0, 100, 20, 60, 1, 110, 30, 70, 128, 120, 40, 80, 255]));
});

it("copies GBRAP packets including a partial final packet without decoding", async () => {
  const input = Buffer.concat([planes, planes.subarray(0, 7)]);
  const result = await run(input, ["-c:v", "copy"], { features: { videoTranscode: false }, limits: { maxFrames: 0 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, input);
});

it("enforces frame limits before replacing the destination", async () => {
  const result = await run(planes, ["-pix_fmt", "rgba"], { limits: { maxFrames: 0 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxFrames/);
  assert.equal(result.output.toString(), "KEEP");
});
