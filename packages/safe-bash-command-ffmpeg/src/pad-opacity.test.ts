import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const pixels = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]);
const input = encodeImage({
  width: 2, height: 1, channels: 4, data: pixels,
  format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;

for (const [opacity, alpha] of [
  ["0b1", null], ["0o1", null], ["0B1", null], ["0O1", null],
  ["0b0", null], ["0o0", null], [" 0b1", null], [" 0o1", null], ["0q1", null],
  ["0.5", 127], ["0x80", 128], ["0X80", 128],
  ["0", 0], ["1", 255], ["5e-1", 127]
] as const) {
  it(`pad ${alpha === null ? "rejects" : "renders"} red@${opacity} before replacing output`, async () => {
    const volume = Volume.fromJSON({ "/output.png": "KEEP" });
    volume.writeFileSync("/input.png", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/input.png", "-vf", `pad=4:1:1:0:red@${opacity}`, "-frames:v", "1", "/output.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const bytes = volume.readFileSync("/output.png") as Buffer;
    const stderr = Buffer.concat(errors).toString();
    if (alpha === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("Invalid color alpha"), stderr);
      assert.equal(bytes.toString(), "KEEP");
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(bytes[25], 6); // PNG IHDR color type: RGBA.
    const output = decodeImage(bytes);
    assert.equal(output.width, 4);
    assert.equal(output.height, 1);
    assert.deepEqual(output.data, new Uint8Array([255, 0, 0, alpha, ...pixels, 255, 0, 0, alpha]));
  });
}
