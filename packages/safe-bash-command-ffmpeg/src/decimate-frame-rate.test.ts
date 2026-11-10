import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const levels = [20, 50, 65, 100, 140, 170, 180, 205, 221];
const frames = levels.map(value => Buffer.concat([
  Buffer.alloc(32 * 32, value), Buffer.alloc(32 * 32 * 2, 128)
]));

// Native FFmpeg 7.0.2: setpts clears the link frame rate, including for PTS.
for (const [filter, expected] of [
  ["setpts=PTS,decimate=cycle=4", null],
  ["setpts=2*PTS,decimate=cycle=4", null],
  ["setpts=PTS,null,decimate=cycle=4", null],
  ["fps=10,setpts=PTS,decimate=cycle=4", null],
  ["setpts=PTS", frames],
  ["decimate=cycle=4", [1, 2, 3, 5, 6, 7, 8].map(i => frames[i]!)],
  ["setpts=PTS+2/TB,fps=10,decimate=cycle=4", [1, 2, 3, 5, 6, 7, 8].map(i => frames[i]!)]
] as const) {
  it(`decimate checks the input frame rate: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.y4m", Buffer.concat([
      Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
      ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
    ]));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, expected === null ? 234 : 0, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected ?? []));
    if (expected === null) {
      assert.ok(stderr.includes("The input needs a constant frame rate; current rate of 1/0 is invalid"), stderr);
    }
  });
}
