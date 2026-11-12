import assert from "node:assert/strict";
import { it } from "node:test";
import { createFfmpegCommand } from "./index.js";

for (const [width, top, bottom] of [
  [64, [10, 10, 10, 10, 10, 10, 4], [12, 12, 12, 14, 4, 4, 4, 2]],
  [140, [20, 20, 20, 20, 20, 20, 20], [26, 26, 26, 22, 6, 6, 6, 22]]
] as const) {
  it(`aligns SMPTE patches to the native YUV420 grid at width ${width}`, async () => {
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "lavfi", "-i", `smptebars=s=${width}x48:r=1:d=1`,
        "-c:v", "rawvideo", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, fs: {}, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    const output = Buffer.concat(stdout);
    assert.equal(output.length, width * 48 * 3 / 2);
    // Native FFmpeg 7.0.2 run lengths, independent of color conversion values.
    for (const [row, expected] of [[0, top], [34, top], [47, bottom]] as const) {
      const luma = output.subarray(row * width, (row + 1) * width);
      const runs: number[] = [];
      for (let x = 0; x < width; x++) {
        if (x === 0 || luma[x] !== luma[x - 1]) runs.push(1);
        else runs[runs.length - 1]!++;
      }
      assert.deepEqual(runs, expected, `row ${row}`);
    }
  });
}
