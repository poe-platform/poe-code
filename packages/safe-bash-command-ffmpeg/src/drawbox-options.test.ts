import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

function png(width: number, height: number, pixel: number[]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(pixel, i);
  return encodeImage({ width, height, channels: 4, data, format: "png", space: "srgb",
    depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
}

for (const options of [
  "1:1:6:6:red:bogus", "1:1:6:6:red:1oops", "1:1:6:6:red:1:replace=bogus",
  "1:1:6:6:red:1:typo=1", "1:1:6:6:red:1:box_source=bogus",
  "x=1:y=1:w=6:h=6:c=red:t=bogus", "1:1:6:6:red:1:bogus"
]) {
  it(`rejects drawbox=${options} before replacing sequence outputs`, async () => {
    const volume = Volume.fromJSON({});
    const input = png(8, 8, [20, 40, 60, 80]);
    for (let i = 1; i <= 3; i++) volume.writeFileSync(`/in${i}.png`, input);
    const original = png(1, 1, [90, 70, 50, 255]);
    volume.writeFileSync("/out1.png", original);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-framerate", "1", "-i", "/in%d.png", "-vf", `drawbox=${options}`, "-frames:v", "3", "/out%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(Buffer.concat(errors).toString().includes("drawbox"));
    const output = decodeImage(volume.readFileSync("/out1.png") as Buffer);
    assert.equal(output.width, 1);
    assert.equal(output.height, 1);
    assert.deepEqual(output.data, decodeImage(original).data);
    assert.equal(volume.existsSync("/out2.png"), false);
    assert.equal(volume.existsSync("/out3.png"), false);
  });
}
