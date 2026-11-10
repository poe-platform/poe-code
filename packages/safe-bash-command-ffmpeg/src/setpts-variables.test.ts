import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [filter, expected] of [
  ["setpts=2*N,fps=3", [20, 40, 60, 60, 80, 100, 120]],
  ["setpts=N/TB/5,fps=5", [20, 40, 60, 80, 100, 120]],
  ["setpts=T/TB,fps=5", [20, 40, 60, 80, 100, 120]],
  ["setpts=STARTT/TB+PTS,fps=5", [20, 40, 60, 80, 100, 120]],
  ["setpts=2*PTS,fps=3", [20, 40, 60, 60, 80, 100, 120]],
  ["setpts=PTS-STARTPTS,fps=5", [20, 40, 60, 80, 100, 120]],
  ["setpts=PTS+5,setpts=PTS-STARTT/TB,fps=5", [20, 40, 60, 80, 100, 120]],
  ["setpts=PTS+5,setpts=T/TB-5,fps=5", [20, 40, 60, 80, 100, 120]],
  ["select='gte(n,2)',setpts=N/TB/5,fps=5", [60, 80, 100, 120]],
] as const) {
  it(`setpts variables feed the downstream fps timeline: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/out": "KEEP" });
    volume.writeFileSync("/in.gray", new Uint8Array([20, 40, 60, 80, 100, 120]));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "1x1", "-framerate", "5", "-i", "/in.gray", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual([...volume.readFileSync("/out") as Buffer], expected);
  });
}
