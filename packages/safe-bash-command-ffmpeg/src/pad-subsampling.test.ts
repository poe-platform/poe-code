import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));

async function pad(filter: string, source = input) {
  const volume = Volume.fromJSON({});
  const inputPath = source === input ? "/input.mp4" : "/input.png";
  volume.writeFileSync(inputPath, source);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", inputPath, "-vf", filter, "-frames:v", "1", "/output.png"],
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

it("aligns YUV420 pad offsets to the chroma grid", async () => {
  const aligned = await pad("pad=80:60:4:4:black");
  const output = await pad("pad=80:60:5:5:black");
  assert.equal(output.width, 80);
  assert.equal(output.height, 60);
  assert.ok(Buffer.from(output.data).equals(Buffer.from(aligned.data)));
});

it("preserves odd pad offsets for RGBA video and PNG images", async () => {
  const full = await pad("null");
  const png = encodeImage(full, { format: "png" }).data;
  for (const output of [
    await pad("format=rgba,pad=80:60:5:5:black"),
    await pad("pad=80:60:5:5:black", Buffer.from(png))
  ]) {
    assert.equal(output.width, 80);
    assert.equal(output.height, 60);
    assert.deepEqual(Array.from(output.data.subarray((4 * 80 + 4) * 4, (4 * 80 + 5) * 4)), [0, 0, 0, 255]);
    for (let y = 0; y < full.height; y++) {
      const start = ((y + 5) * 80 + 5) * 4;
      assert.deepEqual(output.data.subarray(start, start + full.width * 4), full.data.subarray(y * full.width * 4, (y + 1) * full.width * 4));
    }
  }
});

// FFmpeg n9.0.2-61-gd59078794d linuxarm64-gpl-9.0, raw RGBA output.
// Archive SHA-256: beed6cce0226be087e78c691c15ec91e48f78ab2ca6aca0a017365ad9b19eb92.
it("matches native AArch64 FFmpeg for odd YUV420 pad offsets", async () => {
  const output = await pad("pad=80:60:5:5:black");
  assert.equal(output.data.length, 80 * 60 * 4);
  assert.equal(createHash("sha256").update(output.data).digest("hex"),
    "91ef47d9cee84c1c65ebb9a6ee1bf2a2d70a5f2c5bf76b86cd57e702171033db");
});
