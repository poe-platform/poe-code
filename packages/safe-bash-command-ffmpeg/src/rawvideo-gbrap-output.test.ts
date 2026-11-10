import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const rgba = Buffer.from([
  [50, 30, 212, 255], [120, 180, 60, 128], [120, 180, 60, 128], [80, 140, 190, 32]
].flatMap(pixel => Array.from({ length: 4 }, () => pixel).flat()));
// Native FFmpeg 7.0.2: four 2x2 frames, each with G, B, R, A planes.
const gbrap = Buffer.from(
  "1e1e1e1ed4d4d4d432323232ffffffffb4b4b4b43c3c3c3c7878787881818181" +
  "b4b4b4b43c3c3c3c78787878818181818c8c8c8cbebebebe5050505020202020", "hex");

async function run(bytes: Uint8Array, outputFormat: string, options: Parameters<typeof createFfmpegCommand>[0] = {}, filter = "null", inputFormat = "rgba") {
  const volume = Volume.fromJSON({ "/in.rgba": Buffer.from(bytes), "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", inputFormat, "-video_size", "2x2",
      "-framerate", "4", "-i", "/in.rgba", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", outputFormat, "-f", "rawvideo", "/out.raw"],
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

it("writes each GBRAP frame in native G, B, R, A plane order", async () => {
  const result = await run(rgba, "gbrap");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, gbrap);
});

it("keeps packed RGBA output and alpha unchanged", async () => {
  const result = await run(rgba, "rgba");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, rgba);
});

it("writes distinct pixels in row order within each GBRAP plane", async () => {
  const result = await run(Buffer.from([
    50, 30, 212, 0, 120, 180, 60, 127, 120, 180, 60, 128, 80, 140, 190, 255
  ]), "gbrap");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, Buffer.from([
    30, 180, 180, 140, 212, 60, 60, 190, 50, 120, 120, 80, 0, 127, 129, 255
  ]));
});

it("checks all four GBRAP planes before replacing the destination", async () => {
  const result = await run(rgba, "gbrap", { limits: { maxOutputBytes: 63 } });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /maxOutputBytes/);
  assert.equal(result.output.toString(), "KEEP");
});

it("does not round GBRAP alpha again after the format filter", async () => {
  const result = await run(rgba, "gbrap", {}, "format=gbrap");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, gbrap);
});

it("preserves existing GBRAP planes when encoding planar input", async () => {
  const result = await run(gbrap, "gbrap", {}, "null", "gbrap");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.output, gbrap);
});
