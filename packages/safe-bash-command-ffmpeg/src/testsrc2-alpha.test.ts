import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderTestsrc2Alpha } from "./testsrc2-alpha.js";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [alpha, format, transparent] of [
  [64, ",format=yuva420p", true],
  [255, ",format=yuva420p", false],
  [64, "", false],
  [0, ",format=pix_fmts=yuva420p", true],
  [64, ",format=yuv420p", false]
] as const) {
  it(`preserves testsrc2 alpha=${alpha} with source format '${format}'`, async () => {
    const volume = Volume.fromJSON({});
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "lavfi", "-i", `testsrc2=s=64x48:r=2:d=1:alpha=${alpha}${format}`,
        "-c:v", "rawvideo", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    const output = Buffer.concat(stdout);
    assert.equal(output.length, 2 * 64 * 48 * 4);
    // Native FFmpeg: the opaque 8x8 square moves from (0,0) to (6,8).
    for (let frame = 0; frame < 2; frame++) {
      const histogram: Record<number, number> = {};
      for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
        const actual = output[(frame * 64 * 48 + y * 64 + x) * 4 + 3]!;
        const square = x >= frame * 6 && x < frame * 6 + 8 && y >= frame * 8 && y < frame * 8 + 8;
        assert.equal(actual, transparent && !square ? alpha : 255, `frame ${frame}, (${x},${y})`);
        histogram[actual] = (histogram[actual] ?? 0) + 1;
      }
      assert.deepEqual(histogram, transparent ? { [alpha]: 3008, 255: 64 } : { 255: 3072 });
    }
  });
}

// Native FFmpeg alpha planes for eight frames at 2 fps, including the
// beating rectangles, bouncing-square reflections, and sub-16px sources.
for (const [width, height, hash] of [
  [8, 8, "5f50c0e230322d48832fa4c9bef55470b558f5b69724e3e07f9370f4b690a897"],
  [32, 24, "d00b60ceda6ac3e13a998d639e275e8a2b226cd80f971a356c0067a7c476fe43"],
  [64, 64, "9ee33584fde26297bea76d8beb113a4c8fea08f22d2e8388099be53c717b0284"],
  [96, 80, "d11e345d14239bf5abbc5f2b69a98b52f646da3438fc1088dbf0b2c7ec3d5db2"]
] as const) {
  it(`matches native testsrc2 alpha at ${width}x${height}`, () => {
    const digest = createHash("sha256");
    for (let frame = 0; frame < 8; frame++) {
      const data = new Uint8Array(width * height * 4);
      for (const ignored of renderTestsrc2Alpha(data, width, height, frame / 2, 64)) { /* drain cooperative work */ }
      digest.update(data.filter((_, offset) => offset % 4 === 3));
    }
    assert.equal(digest.digest("hex"), hash);
  });
}
