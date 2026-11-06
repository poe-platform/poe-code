import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const output of ["/out.png", "/out%02d.png"]) {
  for (const limit of [undefined, 1, 2]) {
    for (const update of [[], ["-update", "0"]]) {
      it(`image2 single filename guards ${output}, limit ${limit ?? "none"}, options ${update.join(" ")}`, async () => {
        const volume = new Volume();
        const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
        colors.forEach((color, i) => volume.writeFileSync(`/f0${i}.png`, encodeImage({
          width: 16, height: 16, channels: 4,
          data: Uint8Array.from({ length: 16 * 16 * 4 }, (_, channel) => color[channel % 4]!),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data));
        const writes: { path: string; pixel: number[] }[] = [];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-i", "/f%02d.png", ...update,
            ...(limit === undefined ? [] : ["-frames:v", String(limit)]), output],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) {
              writes.push({ path, pixel: [...decodeImage(bytes).data.slice(0, 4)] });
              volume.writeFileSync(path, bytes);
            },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        const numbered = output.includes("%02d");
        const fails = !numbered && limit !== 1;
        assert.equal(result.exitCode !== 0, fails, Buffer.concat(errors).toString());
        if (fails) assert.match(Buffer.concat(errors).toString(), /Cannot write more than one file with the same name/);
        const expected = colors.slice(0, numbered ? limit ?? 3 : 1).map((pixel, i) => ({
          path: numbered ? `/out0${i + 1}.png` : output, pixel
        }));
        assert.deepEqual(writes, expected);
        assert.deepEqual(volume.readdirSync("/"), ["f00.png", "f01.png", "f02.png", ...expected.map(({ path }) => path.slice(1))]);
        for (const { path, pixel } of expected) {
          assert.deepEqual([...decodeImage(volume.readFileSync(path) as Buffer).data.slice(0, 4)], pixel);
        }
      });
    }
  }
}
