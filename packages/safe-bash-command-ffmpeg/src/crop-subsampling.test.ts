import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));

async function crop(filter: string) {
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

it("aligns default YUV420 crop dimensions and offsets to the chroma grid", async () => {
  const aligned = await crop("crop=32:24:10:6");
  for (const filter of ["crop=32:24:11:7", "crop=33:25:11:7:exact=0", "crop=32:24:11:7:0:0"]) {
    const output = await crop(filter);
    assert.equal(output.width, 32);
    assert.equal(output.height, 24);
    assert.deepEqual(output.data, aligned.data, filter);
  }
});

it("preserves exact crop coordinates and dimensions when requested", async () => {
  const full = await crop("null");
  for (const filter of ["crop=33:25:11:7:exact=1", "crop=33:25:11:7:0:1", "format=rgba,crop=33:25:11:7"]) {
    const output = await crop(filter);
    assert.equal(output.width, 33);
    assert.equal(output.height, 25);
    for (let y = 0; y < 25; y++) {
      const start = ((y + 7) * full.width + 11) * 4;
      assert.deepEqual(output.data.subarray(y * 33 * 4, (y + 1) * 33 * 4), full.data.subarray(start, start + 33 * 4));
    }
  }
});

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
it("matches native FFmpeg for odd default YUV420 crop offsets", { skip: !nativeAvailable }, async () => {
  const filter = "crop=32:24:11:7";
  const output = await crop(filter);
  const native = spawnSync("ffmpeg", [
    "-v", "error", "-i", "pipe:0", "-vf", filter,
    "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"
  ], { input });
  assert.equal(native.status, 0, native.stderr.toString());
  assert.equal(output.data.length, native.stdout.length);
  for (let i = 0; i < output.data.length; i++) {
    assert.ok(Math.abs(output.data[i]! - native.stdout[i]!) <= 1, `channel ${i}`);
  }
});
