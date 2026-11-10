import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const source = [20, 40, 60, 80, 100, 120];

// Native FFmpeg 7.0.2 exit status and exact destination bytes.
for (const [filter, expected] of [
  ["setpts=FR,trim=start_pts=4", source],
  ["setpts=FRAME_RATE,trim=start_pts=4", source],
  ["setpts=PTS+INTERLACED,fps=5", source],
  ["setpts=5,trim=start_pts=4", source],
  ["setpts=PTS,fps=5", source],
  ["setpts=PTS,setpts=isnan(FR),trim=start_pts=1", source],
  ["setpts=PTS,setpts=isnan(FRAME_RATE),trim=start_pts=1", source],
  ["fps=2,setpts=FR,trim=start_pts=3", []],
  ["fps=2,setpts=FRAME_RATE,trim=start_pts=2", [40, 80]],
] as const) {
  it(`setpts exposes stream state: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/out": "KEEP" });
    volume.writeFileSync("/in.gray", Buffer.from(source));
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

for (const [field, filter, expected] of [
  ["p", "setpts=INTERLACED,trim=start_pts=1", []],
  ["t", "setpts=INTERLACED,trim=start_pts=1", source.flatMap(value => [value, value, value, value])],
  ["b", "setpts=INTERLACED,trim=start_pts=1", source.flatMap(value => [value, value, value, value])],
  ["p", "telecine=pattern=23,setpts=INTERLACED,trim=start_pts=1", [40, 40, 60, 60, 60, 60, 80, 80, 100, 100, 100, 100, 120, 120, 120, 120]],
  ["p", "tinterlace=4,setpts=INTERLACED,trim=start_pts=1", source.flatMap(value => [value, value])],
] as const) {
  it(`setpts reads interlace state from Y4M I${field} and filters: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/out": "KEEP" });
    volume.writeFileSync("/in.y4m", Buffer.concat([
      Buffer.from(`YUV4MPEG2 W2 H2 F5:1 I${field} A1:1 Cmono XCOLORRANGE=FULL\n`),
      ...source.map(value => Buffer.concat([Buffer.from("FRAME\n"), Buffer.from([value, value, value, value])]))
    ]));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
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
