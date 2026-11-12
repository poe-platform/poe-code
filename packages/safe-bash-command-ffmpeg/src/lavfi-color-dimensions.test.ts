import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 rounds the default YUV420P color source to its chroma grid.
for (const [size, width, height] of [
  ["5x3", 4, 2], ["5x4", 4, 4], ["4x3", 4, 2], ["4x4", 4, 4], ["3x3", 2, 2]
] as const) {
  it(`rounds color source ${size} to ${width}x${height} in PNG stdout`, async () => {
    const { result, stdout, stderr } = await run([
      "-f", "lavfi", "-i", `color=red:s=${size}:r=1:d=1`,
      "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"
    ]);
    assert.equal(result.exitCode, 0, stderr);
    const image = decodeImage(stdout);
    assert.equal(image.width, width);
    assert.equal(image.height, height);
    assert.equal(image.data.length, width * height * 4);
    for (let offset = 0; offset < image.data.length; offset += 4) {
      assert.deepEqual([...image.data.subarray(offset, offset + 4)], [253, 0, 0, 255]);
    }
  });
}

it("uses rounded dimensions for every frame with the long size option", async () => {
  const { result, volume, stderr } = await run([
    "-f", "lavfi", "-i", "color=c=red:size=5x3:rate=2:duration=1", "/frame%d.png"
  ]);
  assert.equal(result.exitCode, 0, stderr);
  for (const path of ["/frame1.png", "/frame2.png"]) {
    const image = decodeImage(volume.readFileSync(path) as Buffer);
    assert.equal(image.width, 4);
    assert.equal(image.height, 2);
  }
  assert.equal(volume.existsSync("/frame3.png"), false);
});

it("preserves odd RGB testsrc dimensions", async () => {
  const { result, stdout, stderr } = await run([
    "-f", "lavfi", "-i", "testsrc=s=5x3:r=1:d=1", "-frames:v", "1",
    "-c:v", "png", "-f", "image2pipe", "pipe:1"
  ]);
  assert.equal(result.exitCode, 0, stderr);
  const image = decodeImage(stdout);
  assert.equal(image.width, 5);
  assert.equal(image.height, 3);
});

for (const size of ["1x3", "3x1", "1x1"]) {
  it(`rejects color source ${size} when chroma rounding produces an empty axis`, async () => {
    const { result, volume, stderr, stdout } = await run([
      "-y", "-f", "lavfi", "-i", `color=red:s=${size}:r=1:d=1`, "/out.png"
    ]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("color:"), stderr);
    assert.equal(stdout.length, 0);
    assert.equal(volume.readFileSync("/out.png", "utf8"), "keep");
  });
}

async function run(args: string[]) {
  const volume = Volume.fromJSON({ "/out.png": "keep" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...args], cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, volume, stdout: Buffer.concat(stdout), stderr };
}
