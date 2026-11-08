import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const pattern of ["/f%d.png", "/f%02d.png", "/f0.png", "/literal%d.png"]) {
  it(`distinguishes sequence replacement from literal in-place edits: ${pattern}`, async () => {
    const sequence = pattern === "/f%d.png" || pattern === "/f%02d.png";
    const paths = pattern === "/f%02d.png" ? ["/f00.png", "/f01.png"] : ["/f0.png", "/f1.png"];
    const volume = Volume.fromJSON({});
    const colors = [[255, 0, 0, 255], [0, 0, 255, 255]];
    for (const [index, color] of colors.entries()) {
      volume.writeFileSync(paths[index]!, encodeImage({
        width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png" }).data);
    }
    volume.writeFileSync("/literal%d.png", volume.readFileSync(paths[0]!));
    const before = volume.toJSON();
    const literal = volume.readFileSync("/literal%d.png");
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", "2",
        ...(pattern === "/literal%d.png" ? ["-pattern_type", "none"] : []),
        "-i", pattern, "-vf", "negate", "-start_number", "0", pattern],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (!sequence) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("cannot edit existing files in-place"), stderr);
      assert.deepEqual(volume.toJSON(), before);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    for (const [index, color] of colors.entries()) {
      const image = decodeImage(new Uint8Array(volume.readFileSync(paths[index]!) as Uint8Array));
      const inverted = color.map((value, channel) => channel === 3 ? value : 255 - value);
      assert.deepEqual([...image.data], [...inverted, ...inverted, ...inverted, ...inverted]);
    }
    assert.deepEqual(volume.readFileSync("/literal%d.png"), literal);
  });
}
