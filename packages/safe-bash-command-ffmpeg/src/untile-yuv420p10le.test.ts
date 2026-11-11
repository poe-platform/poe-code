import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const sheet = Buffer.from("410059005f01a5028a011302b4026803ff0101020002fe01", "hex");

async function run(input: Buffer, size: string, filter: string, complex = false) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo",
      "-pixel_format", "yuv420p10le", "-video_size", size, "-framerate", "4", "-i", "/in.raw",
      ...(complex ? ["-filter_complex", `[0:v]${filter},showinfo[out]`, "-map", "[out]"]
        : ["-vf", `${filter},showinfo`]),
      "-fps_mode", "passthrough", "-pix_fmt", "yuv420p10le", "-f", "rawvideo", "pipe:1"],
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
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
  return { output: Buffer.concat(output), stderr };
}

// FFmpeg 7.0.2 reference: direct raw sheets retain their original Y, U and V words.
for (const [size, filter, hex, count] of [
  ["4x2", "null", sheet.toString("hex"), 1],
  ["4x2", "untile=1x1", sheet.toString("hex"), 1],
  ["4x2", "untile=2x1", "410059008a011302ff0100025f01a502b40268030102fe01", 2],
  ["2x4", "untile=1x2", "410059005f01a502ff0100028a011302b40268030102fe01", 2]
] as const) {
  for (const complex of [false, true]) {
    it(`preserves 10-bit YUV420 words and timestamps with ${filter} (complex=${complex})`, async () => {
      const { output, stderr } = await run(Buffer.concat([sheet, sheet]), size, filter, complex);
      assert.deepEqual(output, Buffer.from(hex.repeat(2), "hex"));
      const frames = stderr.split("\n").filter(line => line.includes(" pts_time:"));
      assert.equal(frames.length, 2 * count);
      for (const [index, line] of frames.entries()) {
        assert.ok(line.includes(`pts:${index} pts_time:${index / (4 * count)} `), line);
      }
    });
  }
}

it("does not restore stale 10-bit YUV420 planes after RGB filtering", async () => {
  const filter = "format=rgba,negate";
  assert.deepEqual((await run(sheet, "4x2", `${filter},untile=1x1`)).output,
    (await run(sheet, "4x2", filter)).output);
});
