import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, smptebars=s=140x48:r=1:d=1, rawvideo output.
const positions = [[10, 0], [30, 0], [90, 0], [30, 32], [10, 44], [90, 44], [103, 44]] as const;
for (const format of ["yuv420p", "rgb24"]) {
  it(`preserves native SMPTE calibration levels in ${format}`, async () => {
    const bytes = await render("140x48", format);
    if (format === "yuv420p") {
      assert.equal(bytes.length, 10080);
      assert.deepEqual(positions.map(([x, y]) => [bytes[y * 140 + x],
        bytes[6720 + Math.floor(y / 2) * 70 + Math.floor(x / 2)],
        bytes[8400 + Math.floor(y / 2) * 70 + Math.floor(x / 2)]]),
      [[180, 128, 128], [162, 44, 142], [84, 184, 198], [19, 128, 128],
        [57, 156, 97], [16, 128, 128], [7, 128, 128]]);
    } else {
      assert.equal(bytes.length, 20160);
      assert.deepEqual(positions.map(([x, y]) => bytes.subarray((y * 140 + x) * 3, (y * 140 + x) * 3 + 3).toString("hex")),
        ["bebebe", "c0be00", "be00bf", "030303", "003d67", "000000", "000000"]);
    }
  });
}

// Full-frame native hashes also cover every bar, PLUGE pulse, and aligned boundary.
for (const [size, yuv, rgb] of [
  ["140x48", "4f909b50cdfd4c4bdcbfb7f4023e040e138ccb6e63c7cfae61d7ab52730b4633", "68a74f35f719d08605aea180c73c5c65278cc7d33eed0158eefef5bcba54900f"],
  ["28x12", "3b362839c7746546528c657e1b5365745f8d0c6f3b931d38256170fcbe99f760", "7df5b048889b0ee960228521c358b35709895949a7f9e6dade759f21b9c24548"],
  ["142x50", "be1467647d60b4279099e32e2a7d60eb99b743bbb0f0de7f71871723de955b7c", "03cfdc3670ee87fbf87b96a507518a0862d0c232ad762f0208f56ea63f3f1ce1"],
  ["320x240", "4ff09a9a7753b5cbf956b6b626a377acbfc0b86902446c07534f273e0657c04e", "eab5d29fb23182c546b35e47c0f0d400856704023c6981333b60fb7338b69d7f"]
]) {
  for (const [format, expected] of [["yuv420p", yuv], ["rgb24", rgb]]) {
    it(`matches native ${size} SMPTE frames in ${format}`, async () => {
      const bytes = await render(size!, format!, 2);
      const frameSize = bytes.length / 2;
      assert.equal(createHash("sha256").update(bytes.subarray(0, frameSize)).digest("hex"), expected);
      assert.deepEqual(bytes.subarray(frameSize), bytes.subarray(0, frameSize));
    });
  }
}

async function render(size: string, format: string, duration = 1) {
  const volume = Volume.fromJSON({});
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "lavfi", "-i", `smptebars=s=${size}:r=1:d=${duration}`,
      "-c:v", "rawvideo", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(stdout);
}
