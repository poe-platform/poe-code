import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const all = Array.from({ length: 11 }, (_, index) => index + 1);
// Full pixel sequences from FFmpeg 7.0.2, including the rational-rate Y4M header.
for (const [rate, offset, filter, options, format, ids] of [
  ["6", "0.5", "null", [], "rawvideo", [1, 1, 1, ...all]],
  ["6", "0.5", "null", ["-fps_mode", "cfr"], "rawvideo", [1, 1, 1, ...all]],
  ["6", "0.5", "null", ["-fps_mode", "passthrough"], "rawvideo", all],
  ["6", "0.5", "framestep=3", ["-r", "4"], "rawvideo", [1, 1, 1, 4, 4, 7, 7, 10, 10]],
  ["30000/1001", "0.5", "framestep=3", [], "yuv4mpegpipe", [1, 1, 1, 1, 1, 4, 7, 10]],
  ["30000/1001", "0.5", "framestep=3", ["-fps_mode", "passthrough"], "yuv4mpegpipe", [1, 4, 7, 10]],
  ["30000/1001", "0", "framestep=3", [], "yuv4mpegpipe", [1, 4, 7, 10]],
  ["6", "0.5", "null", ["-frames:v", "2"], "rawvideo", [1, 1]],
  ["6", "0", "null", [], "rawvideo", all],
  ["6", "0", "framestep=3", [], "rawvideo", [1, 4, 7, 10]]
] as const) {
  it(`fills leading CFR frames: ${rate} ${offset} ${filter} ${options.join(" ")} ${format}`, async () => {
    const input = Buffer.from(all.flatMap(id => [id, id, id, id]));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
        "-framerate", rate, "-itsoffset", offset, "-i", "/in.raw", "-vf", filter,
        ...options, "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const expected = format === "rawvideo" ? Buffer.from(ids.flatMap(id => [id, id, id, id]))
      : Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F10000:1001 Ip A0:0 Cmono XCOLORRANGE=FULL\n"),
        ...ids.map(id => Buffer.concat([Buffer.from("FRAME\n"), Buffer.from([id, id, id, id])]))]);
    assert.deepEqual(Buffer.concat(chunks), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
