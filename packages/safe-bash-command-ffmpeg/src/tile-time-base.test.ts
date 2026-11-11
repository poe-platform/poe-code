import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from([10, 11, 30, 31, 60, 61, 100, 101, 150, 151]);

async function run(filter: string, format = "framecrc"): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.gray": input });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x1",
      "-framerate", "4", "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough",
      "-pix_fmt", "gray", "-bitexact", "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
  assert.deepEqual(volume.readFileSync("/in.gray"), input);
  return Buffer.concat(stdout);
}

// Native FFmpeg 7.0.2: sheet rate is input rate / (nb_frames - overlap).
for (const [filter, timeBase, dimensions, timestamps, checksums] of [
  ["tile=2x1:overlap=1", "1/4", "4x1", [0, 2, 3, 4],
    ["0x00a40052", "0x018a00b6", "0x02d40142", "0x048201f6"]],
  ["tile=2x2:init_padding=2", "1/1", "4x2", [0, 1], ["0x00a40052", "0x0bf9026f"]],
  ["tile=2x1", "1/2", "4x1", [0, 1, 2], ["0x00a40052", "0x02d40142", "0x041d012d"]],
  ["tile=3x1:overlap=1:init_padding=1", "1/2", "6x1", [0, 1, 2],
    ["0x00a40052", "0x0423017f", "0x086e01f6"]],
  ["tile=2x1,fps=4", "1/4", "4x1", [0, 1, 2, 3, 4],
    ["0x00a40052", "0x00a40052", "0x02d40142", "0x02d40142", "0x041d012d"]],
  ["tile=2x1:overlap=1,fps=source_fps", "1/4", "4x1", [0, 1, 2, 3, 4],
    ["0x00a40052", "0x00a40052", "0x018a00b6", "0x02d40142", "0x048201f6"]],
  ["tile=2x2:init_padding=2,fps=source_fps", "1/1", "4x2", [0], ["0x00a40052"]]
] as const) {
  it(`uses native tile output timing for ${filter}`, async () => {
    const lines = (await run(filter)).toString().trimEnd().split("\n");
    assert.deepEqual(lines.filter(line => line.startsWith("#")), [
      `#tb 0: ${timeBase}`, "#media_type 0: video", "#codec_id 0: rawvideo",
      `#dimensions 0: ${dimensions}`, "#sar 0: 0/1"
    ]);
    const size = dimensions.split("x").map(Number).reduce((a, b) => a * b);
    assert.deepEqual(lines.filter(line => !line.startsWith("#")).map(line => line.split(",").map(x => x.trim())),
      timestamps.map((pts, i) => ["0", String(pts), String(pts), "1", String(size), checksums[i]]));
  });
}

it("preserves native overlapping tile pixels", async () => {
  assert.equal((await run("tile=2x1:overlap=1", "rawvideo")).toString("hex"),
    "0a0b1e1f1e1f3c3d3c3d646564659697");
});
