import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const pixels = Uint8Array.from([255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255,
  255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255]);

for (const [filter, colorType] of [
  ["format=gray", 0],
  ["format=gray8", 0],
  ["format=pix_fmts=gray", 0],
  ["format=gray,format=rgba", 6],
  ["format=gray,format=rgb24", 2],
] as const) {
  it(`${filter} matches native luminance, opaque alpha, and PNG color type`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", encodeImage({ width: 4, height: 2, data: pixels,
      channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.png", "-vf", filter, "-frames:v", "1", "/out.png"],
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
    const output = volume.readFileSync("/out.png") as Buffer;
    // Native FFmpeg's decoded RGBA values for the same two-row fixture.
    const expected = Uint8Array.from([76, 150, 29, 124, 76, 150, 29, 124]
      .flatMap(gray => [gray, gray, gray, 255]));
    assert.deepEqual(decodeImage(output).data, expected);
    assert.equal(output[24], 8);
    assert.equal(output[25], colorType);
  });
}

for (const inputType of ["Buffer", "Uint8Array"]) {
  for (const [filter, expected] of [
    ["null", "113a638cb5de07305982abd4"],
    ["format=gray", "113a638c8080103059828080"],
    ["format=gray8", "113a638c8080103059828080"],
    ["format=pix_fmts=gray,format=yuv420p", "113a638c8080103059828080"],
    ["format=gray,format=gray", "113a638c8080103059828080"]
  ] as const) {
    it(`${filter} converts planar luma without chroma contamination (${inputType})`, async () => {
      const input = Buffer.from("113a638cb5de07305982abd4", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const reads: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "2x2", "-r", "1",
          "-i", "/in.raw", "-vf", filter, "-pix_fmt", "yuv420p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) {
            const bytes = volume.readFileSync(path) as Buffer;
            const data = inputType === "Buffer" ? bytes : Uint8Array.from(bytes);
            reads.push(data);
            return data;
          },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      // Native FFmpeg 7.0.2 output, including both chroma planes and both frames.
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      for (const bytes of reads) assert.deepEqual(Buffer.from(bytes), input, "input remains unchanged");
    });
  }
}
