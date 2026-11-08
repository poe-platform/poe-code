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
  const existing = png([99], 1);
  volume.writeFileSync("/out1.png", existing);
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
  return { volume, existing, result, stderr: Buffer.concat(errors).toString() };
}

for (const direction of ["hflip", "vflip"]) {
  for (const option of ["typo=1", "enable=bogus", "1", "enable=1:typo=1", "enable="]) {
    it(`${direction} rejects ${option} before writing any output frames`, async () => {
      const { volume, existing, result, stderr } = await render(`${direction}=${option}`);
      assert.equal(result.exitCode, 1, stderr);
      assert.ok(stderr.includes(direction), stderr);
      assert.deepEqual(volume.readFileSync("/out1.png"), Buffer.from(existing));
      assert.equal(volume.existsSync("/out2.png"), false);
      assert.equal(volume.existsSync("/out3.png"), false);
    });
  }

  for (const option of ["", "=enable=0", "=enable=1", "=enable=gte(n\\,1)", "=enable='gte(t,1)'"]) {
    it(`${direction}${option} produces the expected pixels across three frames`, async () => {
      const { volume, result, stderr } = await render(direction + option);
      assert.equal(result.exitCode, 0, stderr);
      const flipped = direction === "hflip" ? [30, 20, 10, 60, 50, 40] : [40, 50, 60, 10, 20, 30];
      for (let i = 1; i <= 3; i++) {
        const output = decodeImage(volume.readFileSync(`/out${i}.png`) as Buffer);
        const expected = option === "=enable=0" || (option.includes("gte") && i === 1) ? levels : flipped;
        assert.equal(output.width, 3);
        assert.equal(output.height, 2);
        assert.deepEqual(output.data, new Uint8Array(expected.flatMap(value => [value, value, value, 255])));
      }
    });
  }
}
