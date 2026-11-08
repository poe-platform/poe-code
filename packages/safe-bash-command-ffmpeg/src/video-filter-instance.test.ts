import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const levels = [10, 20, 30, 40, 50, 60];
function png(values: number[], width: number) {
  return encodeImage({
    width, height: values.length / width, channels: 4,
    data: new Uint8Array(values.flatMap(value => [value, value, value, 255])),
    format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
  }, { format: "png" }).data;
}

async function render(filter: string) {
  const volume = new Volume();
  for (let i = 1; i <= 3; i++) volume.writeFileSync(`/in${i}.png`, png(levels, 3));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-framerate", "1", "-i", "/in%d.png", "-vf", filter, "-frames:v", "3", "/out%d.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { volume, result, stderr: Buffer.concat(errors).toString() };
}

for (const [filter, expected] of [
  ["hflip", [30, 20, 10, 60, 50, 40]],
  ["hflip@named", [30, 20, 10, 60, 50, 40]],
  ["vflip", [40, 50, 60, 10, 20, 30]],
  ["vflip@named", [40, 50, 60, 10, 20, 30]],
  ["hflip@first,vflip@second", [60, 50, 40, 30, 20, 10]]
] as const) {
  it(`${filter} resolves video filter names independently of instance identifiers`, async () => {
    const { volume, result, stderr } = await render(filter);
    assert.equal(result.exitCode, 0, stderr);
    for (let i = 1; i <= 3; i++) {
      const output = decodeImage(volume.readFileSync(`/out${i}.png`) as Buffer);
      assert.equal(output.width, 3);
      assert.equal(output.height, 2);
      assert.deepEqual(output.data, new Uint8Array(expected.flatMap(value => [value, value, value, 255])));
    }
  });
}
