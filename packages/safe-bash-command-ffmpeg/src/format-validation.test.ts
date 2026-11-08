import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const input = encodeImage({ width: 4, height: 2,
  data: Uint8Array.from([255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255,
    255, 0, 0, 64, 0, 255, 0, 128, 0, 0, 255, 192, 200, 100, 50, 255]),
  channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
}, { format: "png" }).data;
const original = encodeImage({ width: 1, height: 1, data: new Uint8Array([80, 80, 80, 255]),
  channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
}, { format: "png" }).data;

for (const argument of ["bogus", "gray|bogus", "bogus|rgba", "rgba:color_ranges=bogus",
  "rgba:typo=1", "gray:typo=1", "pix_fmts=rgba|bogus", "notgray", "rgbBogus",
  "rgba|", "|gray", "rgba:pix_fmtsX", "rgba::bogus", "pix_fmts=", "rgba:pix_fmts=bogus",
  "pix_fmts=bogus:pix_fmts=rgba", "rgba:color_spaces=bogus"]) {
  it(`rejects format=${argument} without replacing output`, async () => {
    const { result, volume, errors } = await convert(argument);
    assert.notEqual(result.exitCode, 0);
    assert.match(errors, /format:/);
    assert.deepEqual(volume.readFileSync("/out.png"), Buffer.from(original));
  });
}

for (const argument of ["rgba", "pix_fmts=rgba", "rgba|rgb24", "gray", "pix_fmts=gray"]) {
  it(`accepts format=${argument}`, async () => {
    const { result, volume, errors } = await convert(argument);
    assert.equal(result.exitCode, 0, errors);
    const image = decodeImage(volume.readFileSync("/out.png") as Buffer);
    assert.equal(image.width, 4);
    assert.equal(image.height, 2);
    if (!argument.includes("gray")) assert.deepEqual(image.data, decodeImage(input).data);
    else for (let i = 0; i < image.data.length; i += 4) {
      assert.equal(image.data[i], image.data[i + 1]);
      assert.equal(image.data[i], image.data[i + 2]);
    }
  });
}

async function convert(argument: string) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.png", input);
  volume.writeFileSync("/out.png", original);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.png", "-vf", `format=${argument}`, "-frames:v", "1", "/out.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, errors: Buffer.concat(errors).toString() };
}
