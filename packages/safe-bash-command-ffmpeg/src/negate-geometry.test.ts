import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/negate-geometry.mp4", import.meta.url));

async function render(filter: string) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.mp4", input);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.mp4", "-vf", filter, "-frames:v", "1", "/out.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  return decodeImage(volume.readFileSync("/out.png") as Buffer);
}

// Native FFmpeg 7.0.2 produces byte-identical RGBA8 frames for both orders.
for (const geometry of ["hflip", "vflip", "crop=8:8:0:0", "crop=8:6:4:2", "hflip,crop=8:8:4:2,vflip"]) {
  for (const negate of ["negate", "negate=components=y", "negate=components=u+v"]) {
    it(`preserves YUV ${negate} before and after ${geometry}`, async () => {
      const first = await render(`${geometry},${negate}`);
      const second = await render(`${negate},${geometry}`);
      assert.equal(first.width, second.width);
      assert.equal(first.height, second.height);
      assert.deepEqual(first.data, second.data);
    });
  }
}

// Native reference pixels distinguish YUV negation from inverted decoded RGB.
for (const [geometry, x, y, expected] of [
  ["hflip", 10, 12, [0, 132, 255, 255]],
  ["vflip", 5, 3, [0, 132, 255, 255]],
  ["crop=8:8:0:0", 4, 0, [131, 255, 4, 255]]
] as const) {
  it(`matches native YUV negation after ${geometry}`, async () => {
    const output = await render(`${geometry},negate`);
    const offset = (y * output.width + x) * 4;
    // Decoder/converter rounding may differ by one; the filter-order checks above are exact.
    for (let channel = 0; channel < 4; channel++) {
      assert.ok(Math.abs(output.data[offset + channel]! - expected[channel]!) <= 1, `channel ${channel}`);
    }
  });
}
