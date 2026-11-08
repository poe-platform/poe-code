import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const size of ["-1:-1", "-2:-2", "-4:-1", "w=-iw:h=-ih", "10:-1", "-1:6", "0:-1", "-1:0"]) {
  it(`preserves native dimensions and pixels for scale=${size}`, async () => {
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
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(output.width, size === "10:-1" ? 10 : 9);
    assert.equal(output.height, size === "10:-1" ? 7 : 6);
    if (size === "10:-1") {
      const reference = await command.execute({ ...context, args: ["-i", "/in.png", "-vf", "scale=10:7", "-frames:v", "1", "/reference.png"] } as never);
      assert.equal(reference.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(output.data, decodeImage(volume.readFileSync("/reference.png") as Buffer).data);
    } else {
      assert.deepEqual(output.data, pixels);
    }
  });
}
