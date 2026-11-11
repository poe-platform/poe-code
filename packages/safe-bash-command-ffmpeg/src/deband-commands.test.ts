import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const frame = Buffer.from(Array.from({ length: 256 }, (_, i) =>
  96 + 2 * Math.floor((i % 16) / 3) + Math.floor(Math.floor(i / 16) / 4)));
const input = Buffer.concat([frame, frame, frame]);
const unchanged = "a6704ede64e3301a7b4edca1ac8821a0044807ba3ea7486a1aa857c58405c842";
const smoothed = "9f39e72b8427cd5b6476c5d20866f6afa0df0bafae100b4f4de2ab0bc0518bd5";
const firstSmoothed = "8fa0752446d726d3cd8d0b00dad4aa058035b4841a92314c7580221d917625e4";

// Complete rawvideo hashes from Linux FFmpeg 7.0.2, including all three frames.
for (const [filter, hash] of [
  ["deband=r=-3:d=-1:1thr=0.1", smoothed],
  ["deband=r=-3:d=-1:1thr=0.001", unchanged],
  ["sendcmd=c='0.25 deband 1thr 0.001',deband=r=-3:d=-1:1thr=0.1", firstSmoothed],
  ["sendcmd=commands='0.25 [enter] deband@v 1thr 1/1000',deband@v=r=-3:d=-1:1thr=0.1", firstSmoothed],
  ["sendcmd=c='0.26 deband@v 1thr 0.001',deband@v=r=-3:d=-1:1thr=0.1",
    "6d93a11879db2622237e5068879820738c03d88a329c9f637eadca2975076d6d"],
  ["sendcmd=c='0.5 deband 1thr 0.1;0.25 deband 1thr 0.001',deband=r=-3:d=-1:1thr=0.1",
    "b58125f89bcd16ac5620155363ed71b49e13f23154100239852bf5b39fa2a410"],
  ["sendcmd=c='0.25 deband 1thr nope;0.5 deband 1thr 0',deband=r=-3:d=-1:1thr=0.1", smoothed],
  ["sendcmd=c='0.25 deband 1thr 0.6;0.5 deband 1thr 0.001',deband=r=-3:d=-1:1thr=0.1",
    "6d93a11879db2622237e5068879820738c03d88a329c9f637eadca2975076d6d"],
  ["sendcmd=c='0.25 deband 2thr 0.001;0.25 deband 3thr 0.001;0.25 deband 4thr 0.001',deband=r=-3:d=-1:1thr=0.1", smoothed],
  ["sendcmd=c='0.25 deband@other 1thr 0.001;1 deband 1thr 0.001',deband@v=r=-3:d=-1:1thr=0.1", smoothed],
  ["sendcmd=c='0.25 deband 1thr 0.001',deband@a=r=-3:d=-1:1thr=0.1,deband@b=r=-3:d=-1:1thr=0.1",
    "1f8eaec2e19a92ee1691272250606a8a5b1323586a5756fdd29325d3c2ffa9a5"],
  ["sendcmd=c='0.25 deband@b 1thr 0.001',deband@a=r=-3:d=-1:1thr=0.1,deband@b=r=-3:d=-1:1thr=0.1",
    "1f8eaec2e19a92ee1691272250606a8a5b1323586a5756fdd29325d3c2ffa9a5"]
] as const) {
  it(`matches native timed deband thresholds: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input });
    const argumentValues = createCommandArguments([
      "-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "16x16",
      "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"
    ]);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
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
    const output = Buffer.concat(chunks);
    assert.equal(output.length, input.length);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
