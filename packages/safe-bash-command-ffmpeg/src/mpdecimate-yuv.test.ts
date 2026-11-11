import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

for (const format of ["yuv420p", "yuv422p", "yuv444p", "gray"]) {
  for (const [levels, expected] of [
    [[40, 45, 100], [0, 2]],
    [[40, 46, 100], [0, 1, 2]],
    [[40, 45, 50], [0, 2]]
  ] as const) {
    it(`mpdecimate compares native ${format} luma: ${levels}`, async () => {
      const chromaSize = format === "yuv420p" ? 64 : format === "yuv422p" ? 128 : format === "gray" ? 0 : 256;
      const frames = levels.map(level => Buffer.concat([Buffer.alloc(256, level), Buffer.alloc(chromaSize * 2, 128)]));
      await checkFrames(format, 16, frames, expected);
    });
  }
}

for (const plane of [1, 2]) {
  for (const difference of [5, 6]) {
    it(`mpdecimate compares native YUV420 chroma plane ${plane} at difference ${difference}`, async () => {
      const frames = [0, difference, 30].map(change => Buffer.concat([
        Buffer.alloc(32 * 32, 40),
        Buffer.alloc(16 * 16, 128 + (plane === 1 ? change : 0)),
        Buffer.alloc(16 * 16, 128 + (plane === 2 ? change : 0))
      ]));
      await checkFrames("yuv420p", 32, frames, difference === 5 ? [0, 2] : [0, 1, 2]);
    });
  }
}

async function checkFrames(format: string, size: number, frames: Buffer[], expected: readonly number[]): Promise<void> {
  const input = Buffer.concat(frames);
  const volume = Volume.fromJSON({ "/in.raw": input });
  const argumentValues = createCommandArguments([
    "-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", format,
    "-video_size", `${size}x${size}`, "-framerate", "4", "-i", "/in.raw", "-vf", "mpdecimate,showinfo",
    "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"
  ]);
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args: argumentValues.args, argumentValues,
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
  assert.deepEqual(Buffer.concat(output), Buffer.concat(expected.map(i => frames[i]!)));
  const pts = stderr.split("\n").filter(line => line.includes(" pts:")).map(line => Number(line.split(" pts:")[1]!.trim().split(" ")[0]));
  assert.deepEqual(pts, expected);
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
}
