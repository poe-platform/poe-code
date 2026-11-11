import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Buffer.from([
  20, 20, 20, 20, 20, 20, 20, 20,
  20, 20, 20, 24, 20, 20, 20, 24,
  20, 20, 20, 24, 250, 0, 0, 24
]);
const firstFreeze = "lavfi.freezedetect.freeze_start: 0\n" +
  "lavfi.freezedetect.freeze_duration: 0.5\n" +
  "lavfi.freezedetect.freeze_end: 0.5\n";
const secondFreeze = "lavfi.freezedetect.freeze_start: 0.5\n" +
  "lavfi.freezedetect.freeze_duration: 0.75\n" +
  "lavfi.freezedetect.freeze_end: 1.25\n";

for (const [suffix, count, report] of [
  ["", 6, firstFreeze + secondFreeze],
  [",trim=end_frame=2", 2, firstFreeze],
  [",trim=end=0.5", 2, firstFreeze],
  [",trim=end_pts=2", 2, firstFreeze],
  [",trim=duration=0.5", 2, firstFreeze],
  [",trim=end_frame=1", 1, ""],
  [",null,trim=end_frame=2", 2, firstFreeze],
  [",select=1,trim=end_frame=2", 2, firstFreeze],
  [",trim=end_frame=2,metadata=print", 2, firstFreeze]
] as const) {
  it(`stops freeze detection when downstream consumption ends (${suffix || "untrimmed control"})`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": samples });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "1x1", "-framerate", "4", "-i", "in.raw", "-vf", `freezedetect=n=0:d=0.5${suffix}`,
        "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const error = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(Buffer.concat(output), samples.subarray(0, count * 4));
    assert.equal(error, report);
  });
}
