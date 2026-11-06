import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));

async function drawbox(filter: string) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.mp4", input);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/input.mp4", "-vf", filter, "-frames:v", "1", "/output.png"],
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
  return decodeImage(volume.readFileSync("/output.png") as Buffer);
}

// FFmpeg 9.0.2, first frame of the checked-in YUV420 H.264 clip.
it("blends translucent drawbox in the source YUV planes", async () => {
  const output = await drawbox("drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill");
  assert.deepEqual(Array.from(output.data.slice((10 * 64 + 15) * 4, (10 * 64 + 15) * 4 + 4)), [255, 42, 31, 255]);
});

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
for (const filter of [
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill",
  "drawbox=x=10:y=5:w=20:h=15:color=red@1:t=fill",
  "drawbox=x=11:y=5:w=19:h=15:color=blue@0.3:t=2",
  "drawbox=x=-3:y=-1:w=20:h=15:color=green@0.7:t=3",
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill:replace=1",
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill,negate",
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill,drawbox=x=15:y=7:w=8:h=9:color=blue@0.5:t=1",
  "format=rgba,drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill"
]) {
  it(`matches native FFmpeg pixels for ${filter}`, { skip: !nativeAvailable }, async () => {
    const output = await drawbox(filter);
    const native = spawnSync("ffmpeg", [
      "-v", "error", "-i", "pipe:0", "-vf", filter,
      "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"
    ], { input });
    assert.equal(native.status, 0, native.stderr.toString());
    assert.equal(output.data.length, native.stdout.length);
    for (let i = 0; i < output.data.length; i++) {
      assert.ok(Math.abs(output.data[i]! - native.stdout[i]!) <= 1,
        `channel ${i}: ${output.data[i]} != ${native.stdout[i]}`);
    }
  });
}
