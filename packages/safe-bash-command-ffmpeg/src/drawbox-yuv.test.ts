import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));

async function drawbox(filter: string, pixelFormat?: "yuv420p" | "rgba", source: Buffer = input) {
  const volume = Volume.fromJSON({});
  const inputPath = source === input ? "/input.mp4" : "/input.png";
  const outputPath = pixelFormat ? "/output.raw" : "/output.png";
  volume.writeFileSync(inputPath, source);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", inputPath, "-vf", filter, "-frames:v", "1",
      ...(pixelFormat ? ["-pix_fmt", pixelFormat, "-f", "rawvideo"] : []), outputPath],
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
  return volume.readFileSync(outputPath) as Buffer;
}

// FFmpeg 9.0.2, first frame of the checked-in YUV420 H.264 clip.
it("blends translucent drawbox in the source YUV planes", async () => {
  const output = decodeImage(await drawbox("drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill"));
  assert.deepEqual(Array.from(output.data.slice((10 * 64 + 15) * 4, (10 * 64 + 15) * 4 + 4)), [255, 42, 31, 255]);
});

const nativeAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
for (const filter of [
  "null",
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill",
  "drawbox=x=10:y=5:w=20:h=15:color=red@1:t=fill",
  "drawbox=x=11:y=5:w=19:h=15:color=blue@0.3:t=2",
  "drawbox=x=-3:y=-1:w=20:h=15:color=green@0.7:t=3",
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill:replace=1",
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill,negate",
  "drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill,drawbox=x=15:y=7:w=8:h=9:color=blue@0.5:t=1"
]) {
  it(`matches native FFmpeg YUV planes for ${filter}`, { skip: !nativeAvailable }, async () => {
    // The deterministic codec uses AArch64 RGBA rounding, which differs from x86
    // even for the unfiltered clip. Compare the filter's original planes instead.
    const output = await drawbox(filter, "yuv420p");
    const native = spawnSync("ffmpeg", [
      "-v", "error", "-i", "pipe:0", "-vf", filter,
      "-frames:v", "1", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"
    ], { input });
    assert.equal(native.status, 0, native.stderr.toString());
    assert.deepEqual(output, native.stdout);
  });
}

it("matches native FFmpeg RGBA drawbox with identical decoded input", { skip: !nativeAvailable }, async () => {
  // Share PNG input so the RGBA filter comparison is independent of CPU-specific
  // YUV conversion. The H.264-to-PNG path remains covered by the golden above.
  const source = await drawbox("null");
  const filter = "format=rgba,drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill";
  const output = await drawbox(filter, "rgba", source);
  const native = spawnSync("ffmpeg", [
    "-v", "error", "-i", "pipe:0", "-vf", filter,
    "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"
  ], { input: source });
  assert.equal(native.status, 0, native.stderr.toString());
  assert.deepEqual(output, native.stdout);
});

// FFmpeg n9.0.2-61-gd59078794d linuxarm64-gpl-9.0, raw RGBA output.
// Archive SHA-256: beed6cce0226be087e78c691c15ec91e48f78ab2ca6aca0a017365ad9b19eb92.
// The portable codec uses AArch64 YUV conversion rounding on every platform.
for (const [filter, digest] of [
  ["drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill", "70b24f15efa6083c60058523a56e6757e760ebb67734afe7f03c16d84fee8035"],
  ["drawbox=x=10:y=5:w=20:h=15:color=red@1:t=fill", "1f062bff5880d6a1ddbe4076b24c990771a0e3bde51327bd59bc23a316ce4216"],
  ["drawbox=x=11:y=5:w=19:h=15:color=blue@0.3:t=2", "2092bc1bc5e666ded2bf22646e29376153da863f95fa4effd058412a4f401128"],
  ["drawbox=x=-3:y=-1:w=20:h=15:color=green@0.7:t=3", "2431219ae9ca098d0a47eef80e3bf81d4624f1bbb23e34eb8007ccdc6ed9885e"],
  ["drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill:replace=1", "70b24f15efa6083c60058523a56e6757e760ebb67734afe7f03c16d84fee8035"],
  ["drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill,negate", "af169708a0d5aeec89d59ba68f77161090e6d2ce4923aab8bb190483ff9021ab"],
  ["drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill,drawbox=x=15:y=7:w=8:h=9:color=blue@0.5:t=1", "e1bd499df3b29b72dd21dd36c7b0b34c85dfeb1c8720f4e1b6115692b0aaa7c4"],
  ["format=rgba,drawbox=x=10:y=5:w=20:h=15:color=red@0.5:t=fill", "f6c5a8dd2a386026af491294442cfd836476ea7760b12cff8e83133a87b4c8eb"]
] as const) {
  it(`matches native AArch64 FFmpeg pixels for ${filter}`, async () => {
    const output = decodeImage(await drawbox(filter));
    assert.equal(output.data.length, 64 * 48 * 4);
    assert.equal(createHash("sha256").update(output.data).digest("hex"), digest);
  });
}
