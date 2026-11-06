import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [position, ox, oy] of [
  ["main_w-overlay_w-2:main_h-overlay_h-2", 4, 4],
  ["x=(W-w)/2:y=(H-h)/2", 2, 2],
  ["x=(W-w)/2:y=(H-h)/2:format=auto", 3, 3],
  ["2:2", 2, 2],
  ["y=2", 0, 2],
  ["", 0, 0],
  ["-1:2", -2, 2],
  ["2.9:2.1", 2, 2],
  ["unknown:0", null, null],
  ["2garbage:0", null, null],
  ["1/0:0", null, null],
  ["0:main_h+", null, null]
] as const) {
  it(`evaluates overlay position ${position || "defaults"} without silently replacing invalid output`, async () => {
    const volume = Volume.fromJSON({ "/output.png": "existing output" });
    for (const [name, size, color] of [
      ["base", 8, [0, 0, 255, 255]], ["tile", 2, [255, 0, 0, 255]]
    ] as const) {
      const data = new Uint8Array(size * size * 4);
      for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset);
      volume.writeFileSync(`/${name}.png`, encodeImage({
        width: size, height: size, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data);
    }
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/base.png", "-i", "/tile.png", "-filter_complex",
        `[0:v][1:v]overlay${position ? `=${position}` : ""}`, "-frames:v", "1", "/output.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (ox === null || oy === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("overlay:"));
      assert.equal(volume.readFileSync("/output.png", "utf8"), "existing output");
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = decodeImage(volume.readFileSync("/output.png") as Buffer);
    assert.equal(output.width, 8);
    assert.equal(output.height, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const covered: boolean = x >= ox && x < ox + 2 && y >= oy && y < oy + 2;
        assert.deepEqual(Array.from(output.data.subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4)),
          covered ? [255, 0, 0, 255] : [0, 0, 255, 255], `pixel ${x},${y}`);
      }
    }
  });
}
