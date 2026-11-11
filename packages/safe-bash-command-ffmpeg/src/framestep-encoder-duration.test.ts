import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Packet timing and CRCs from native FFmpeg 7.0.2 with gray 2x2 frames 1..11.
for (const [filter, clock, timeBase, step, duration, ticksPerSecond] of [
  ["framestep=3", "1/1000", "1/1000", 3, 167, 1000],
  ["framestep=3", "demux", "1/6", 3, 1, 6],
  ["framestep=3", "filter", "1/6", 3, 1, 6],
  ["framestep=3", "0", "1/2", 3, 1, 2],
  ["null", "1/1000", "1/1000", 1, 167, 1000]
] as const) {
  it(`${filter} preserves packet durations with encoder clock ${clock}`, async () => {
    const input = Buffer.concat(Array.from({ length: 11 }, (_, index) => Buffer.alloc(4, index + 1)));
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stdout = "", stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "info", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
        "-framerate", "6", "-i", "/in.raw", "-vf", `${filter},showinfo`,
        "-enc_time_base", clock, "-fps_mode", "passthrough", "-f", "framecrc", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.ok(stdout.includes(`#tb 0: ${timeBase}\n`), stdout);
    const frames = Array.from({ length: Math.ceil(11 / step) }, (_, index) => index * step);
    const rows = stdout.trim().split("\n").filter(line => !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim()));
    assert.deepEqual(rows, frames.map(frame => {
      const pts = String(Math.round(frame * ticksPerSecond / 6));
      const crc = `0x${((frame + 1) * 10 * 65536 + (frame + 1) * 4).toString(16).padStart(8, "0")}`;
      return ["0", pts, pts, String(duration), "4", crc];
    }));
    const info = stderr.split("\n").filter(line => line.includes(" pts:"));
    assert.equal(info.length, frames.length, stderr);
    for (const line of info) {
      assert.equal(line.split(" ").find(token => token.startsWith("duration:")), "duration:1", line);
    }
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
