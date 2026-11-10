import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));

async function negate(filter: string, raw = false) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.mp4", input);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/input.mp4", "-vf", filter, "-frames:v", "1",
      ...(raw ? ["-f", "rawvideo", "-pix_fmt", "yuv420p"] : []), "/output.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  return volume.readFileSync("/output.png") as Buffer;
}

// FFmpeg 9.0.2 reference pixels for the checked-in YUV420 H.264 clip.
for (const [filter, expected] of [
  ["negate=components=y", [250, 124, 255, 255]],
  ["negate=components=u+v", [8, 135, 0, 255]],
  ["negate=y", [250, 124, 255, 255]],
  ["negate=components=96", [8, 135, 0, 255]],
  ["negate", [130, 255, 3, 255]],
] as const) {
  it(`selects native YUV planes for ${filter}`, async () => {
    const output = decodeImage(await negate(filter));
    for (let channel = 0; channel < 4; channel++) {
      assert.ok(Math.abs(output.data[channel]! - expected[channel]!) <= 1,
        `channel ${channel}: ${output.data[channel]} != ${expected[channel]}`);
    }
  });
}

it("treats the none component mask like numeric zero on YUV planes", async () => {
  assert.deepEqual(await negate("negate=components=none", true), await negate("negate=components=0", true));
});

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
for (const filter of [
  "negate=components=y", "negate=components=u", "negate=components=v",
  "negate=components=u+v", "negate=components=0",
  "negate=components=y,negate=components=u+v", "negate=components=y,negate=components=y"
]) {
  it(`matches native FFmpeg planes for ${filter}`, { skip: !nativeAvailable }, async () => {
    const output = await negate(filter, true);
    const native = spawnSync("ffmpeg", [
      "-v", "error", "-i", "pipe:0", "-vf", filter,
      "-frames:v", "1", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"
    ], { input });
    assert.equal(native.status, 0, native.stderr.toString());
    // Compare planes exactly: native RGB conversion rounds differently on x86 and ARM.
    assert.deepEqual(output, native.stdout);
  });
}
