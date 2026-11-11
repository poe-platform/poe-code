import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const yuv = "c8b4a08cb4a00a141e2828320a141e282832";
const rgb = "c8b4a0c8b4a0c8b4a0c8b4a00a141e0a141e0a141e0a141e0a141e0a141e0a141e0a141e";

// Native Linux FFmpeg 7.0.2 rawvideo output, including subsampled chroma.
for (const [format, input, filter, expected] of [
  ["yuv420p", yuv, "null", yuv],
  ["rgb24", rgb, "null", rgb],
  ["yuv420p", yuv, "lagfun=decay=0.5:planes=1", "c8b4a08cb4a0645a50462832322d28282832"],
  ["yuv420p", yuv, "lagfun=decay=0.5:planes=2", "c8b4a08cb4a00a141e285a320a141e282d32"],
  ["yuv420p", yuv, "lagfun=decay=0.5:planes=4", "c8b4a08cb4a00a141e2828500a141e282832"],
  ["rgb24", rgb, "lagfun=decay=0.5:planes=1", "c8b4a0c8b4a0c8b4a0c8b4a00a5a1e0a5a1e0a5a1e0a5a1e0a2d1e0a2d1e0a2d1e0a2d1e"],
  ["yuv420p", yuv, "lagfun=planes=0", yuv],
  ["rgb24", rgb, "lagfun=planes=0", rgb]
] as const) {
  it(`matches native ${format} ${filter}`, async () => {
    const source = Buffer.from(input, "hex");
    const volume = Volume.fromJSON({ "/in.raw": source });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format,
        "-video_size", "2x2", "-framerate", "1", "-i", "/in.raw", "-vf", filter,
        "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout.push(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), source);
  });
}
