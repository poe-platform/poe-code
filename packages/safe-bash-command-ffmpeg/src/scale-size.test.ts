import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const size of ["12x8", "size=12x8", "s=12x8", "12X8", "size=12X8", "size=12x8:flags=bicubic", "size=12x", "size=0x8", "size=12x8:w=6", "12x8:6", "size=12x8x2"]) {
  const width = 12;
  const height = 8;
  it(`evaluates dimensions and matches literal-scale pixels for scale=${size}`, async () => {
    const pixels = Uint8Array.from(Array.from({ length: 54 }, (_, i) => [(i + 1) * 4, (i + 1) * 4, (i + 1) * 4, 255]).flat());
    const input = encodeImage({ width: 9, height: 6, data: pixels, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.png", input);
    const errors: Uint8Array[] = [];
    const context = {
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    };
    const command = createFfmpegCommand();
    const result = await command.execute({ ...context, args: ["-i", "/in.png", "-vf", `scale=${size}`, "-frames:v", "1", "/out.png"] } as never);
    if (["size=12x", "size=0x8", "size=12x8:w=6", "12x8:6", "size=12x8x2"].includes(size)) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("scale:"));
      assert.equal(volume.existsSync("/out.png"), false);
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, width);
    assert.equal(output.height, height);
    const reference = await command.execute({ ...context, args: ["-i", "/in.png", "-vf", `scale=${width}:${height}`, "-frames:v", "1", "/reference.png"] } as never);
    assert.equal(reference.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(output.data, decodeImage(volume.readFileSync("/reference.png") as Buffer).data);
  });
}
