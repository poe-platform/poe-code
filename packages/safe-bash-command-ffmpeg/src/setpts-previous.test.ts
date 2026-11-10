import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 outputs for six one-byte gray frames at 5 fps.
for (const [filter, expected] of [
  ["setpts=if(isnan(PREV_OUTPTS)\\,0\\,PREV_OUTPTS+2),fps=3", [20, 40, 60, 60, 80, 100, 120]],
  ["setpts=if(isnan(PREV_INPTS)\\,0\\,PREV_INPTS),fps=3", [40, 80, 120]],
  ["setpts=if(isnan(PREV_OUTT)\\,0\\,(PREV_OUTT+0.4)/TB),trim=start_pts=4", [60, 80, 100, 120]],
  ["setpts=if(isnan(PREV_INT)\\,0\\,PREV_INT/TB),trim=start_pts=4", [120]],
  ["setpts=2*PTS,fps=3", [20, 40, 60, 60, 80, 100, 120]],
  ["setpts=PTS-STARTPTS,fps=5", [20, 40, 60, 80, 100, 120]],
  ["setpts=if(isnan(PREV_OUTPTS)\\,0\\,PREV_OUTPTS+2),setpts=if(isnan(PREV_OUTPTS)\\,0\\,PREV_OUTPTS+2),fps=3", [20, 40, 60, 60, 80, 100, 120]]
] as const) {
  it(`carries video timestamps through ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.gray": Buffer.from([20, 40, 60, 80, 100, 120]), "/out": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "1x1",
        "-framerate", "5", "-i", "/in.gray", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readFileSync("/out"), Buffer.from(expected));
  });
}
