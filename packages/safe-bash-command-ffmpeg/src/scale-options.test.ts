import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const validScales = ["", ":", "iw:ih", "w=iw:h=ih", "width=9:height=6", "iw:ih:flags=bicubic", "iw:ih:flags=neighbor", "iw:ih:flags=lanczos", "0:0"];
for (const scale of [...validScales, "10:10:unknown=1", "bogus:6", "iw:ih:flags=bogus", "10:10:force_divisible_by=0", "10junk:6", "iw/bogus:ih", "iw/0:ih", "9:6:extra", "9:bogus"]) {
  it(`validates scale=${scale} before replacing the existing PNG`, async () => {
    const inputPixels = Uint8Array.from(Array.from({ length: 54 }, (_, i) => [(i + 1) * 4, (i + 1) * 4, (i + 1) * 4, 255]).flat());
    const png = (width: number, height: number, data: Uint8Array) => encodeImage({
      width, height, data, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const previous = png(1, 1, new Uint8Array([23, 45, 67, 255]));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", png(9, 6, inputPixels));
    volume.writeFileSync("/out.png", previous);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.png", "-vf", `scale=${scale}`, "-frames:v", "1", "/out.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (validScales.includes(scale)) {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
      assert.equal(output.width, 9);
      assert.equal(output.height, 6);
      assert.deepEqual(output.data, inputPixels);
      return;
    }
    assert.notEqual(result.exitCode, 0);
    assert.ok(Buffer.concat(errors).toString().includes("scale:"));
    const bytes = volume.readFileSync("/out.png") as Buffer;
    assert.deepEqual(new Uint8Array(bytes), previous);
    const output = decodeImage(bytes);
    assert.equal(output.width, 1);
    assert.equal(output.height, 1);
    assert.deepEqual(output.data, new Uint8Array([23, 45, 67, 255]));
  });
}
