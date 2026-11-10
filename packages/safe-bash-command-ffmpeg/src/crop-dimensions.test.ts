import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const dimensions of ["w=oh*2:h=2", "w=4:h=ow/2", "out_w=out_h*2:out_h=2", "out_w=4:out_h=out_w/2", "w=4:h=2", "w=oh*2:h=2.2", "w=oh:h=ow", "w=oh*4:h=2", "w=oh:h=0", "w=nan:h=2", "w=4:h=NaN", "w=4:h=2:x=0/0"]) {
  it(`resolves crop output dimensions ${dimensions}`, async () => {
    const input = encodeImage({
      width: 7, height: 5, channels: 4,
      data: new Uint8Array(Array.from({ length: 35 }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat()),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const volume = Volume.fromJSON({});
    for (let frame = 1; frame <= 3; frame++) volume.writeFileSync(`/in${frame}.png`, input);
    volume.writeFileSync("/out1.png", "existing output");
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-framerate", "2", "-i", "/in%d.png", "-vf",
        `crop=x=0:y=0:${dimensions}`,
        "-fps_mode", "passthrough", "-frames:v", "3", "/out%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (["w=oh:h=ow", "w=oh*4:h=2", "w=oh:h=0", "w=nan:h=2", "w=4:h=NaN"].includes(dimensions)) {
      assert.equal(result.exitCode, 1);
      assert.ok(Buffer.concat(errors).toString().includes("Invalid too big or non positive size"));
      assert.equal(volume.readFileSync("/out1.png", "utf8"), "existing output");
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    for (let index = 0; index < 3; index++) {
      const output = decodeImage(new Uint8Array(volume.readFileSync(`/out${index + 1}.png`) as Uint8Array));
      assert.equal(output.width, 4);
      assert.equal(output.height, 2);
      assert.deepEqual(output.data, new Uint8Array(Array.from({ length: 8 }, (_, pixel) => {
        const gray = (dimensions.includes("x=") ? 2 : 1) + Math.floor(pixel / 4) * 7 + pixel % 4;
        return [gray, gray, gray, 255];
      }).flat()));
    }
  });
}
