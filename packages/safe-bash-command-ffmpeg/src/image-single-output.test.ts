import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const output of ["/out.png", "/out%02d.png"]) {
  for (const limit of [undefined, 1, 2]) {
    for (const update of [[], ["-update", "0"], ["-c:v", "copy"]]) {
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
        assert.equal(result.exitCode, fails ? 234 : 0, Buffer.concat(errors).toString());
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

for (const [options, exitCode, red] of [
  [[], 234, 32],
  [["-frames:v", "1"], 0, 32],
  [["-update", "1"], 0, 96]
] as const) {
  it(`image2 literal PNG from rawvideo preserves the correct frame: ${options.join(" ")}`, async () => {
    const volume = Volume.fromJSON({
      "/frames.raw": Buffer.from([32, 64, 96].flatMap(value => Array.from({ length: 4 }, () => [value, 0, 0]).flat()))
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2",
        "-framerate", "3", "-i", "/frames.raw", "-c:v", "png", "-f", "image2", ...options, "/still.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.deepEqual(volume.readdirSync("/"), ["frames.raw", "still.png"]);
    const image = decodeImage(volume.readFileSync("/still.png") as Buffer);
    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    assert.deepEqual([...image.data], Array.from({ length: 4 }, () => [red, 0, 0, 255]).flat());
    if (exitCode) assert.ok(stderr.includes("Cannot write more than one file with the same name"));
    else assert.equal(stderr, "");
  });
}
