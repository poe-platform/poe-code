import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [filter, framePts, filenames, expectedColors, option, mode] of [
  ["null", "1", ["000", "001", "002"], [0, 1, 2], "-fps_mode", "passthrough"],
  ["setpts=PTS/2", "1", ["000", "001"], [1, 2], "-fps_mode", "passthrough"],
  ["setpts=PTS/2", "0", ["001", "002", "003"], [0, 1, 2], "-fps_mode", "passthrough"],
  ...["-fps_mode", "-vsync"].flatMap(option => [
    ["setpts=PTS/2", "0", ["001", "002"], [0, 2], option, option === "-vsync" ? "2" : "vfr"],
    ["setpts=PTS/2", "1", ["000", "001"], [0, 2], option, "vfr"],
    ["setpts=2*PTS", "1", ["000", "002", "004"], [0, 1, 2], option, "vfr"],
    ["setpts=0", "0", ["001"], [0], option, "vfr"],
  ] as const)
] as const) {
  it(`image2 preserves collision winners: ${filter}, frame_pts=${framePts}, ${option} ${mode}`, async () => {
    const volume = new Volume();
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    colors.forEach((color, index) => volume.writeFileSync(`/f${index}.png`, encodeImage({
      width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", "2", "-i", "/f%d.png",
        "-vf", filter, option, mode,
        "-frame_pts", framePts, "/o%03d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(volume.readdirSync("/").filter(name => String(name).startsWith("o")).sort(),
      filenames.map(name => `o${name}.png`).sort());
    filenames.forEach((name, index) => {
      const image = decodeImage(volume.readFileSync(`/o${name}.png`) as Buffer);
      assert.deepEqual([...image.data.slice(0, 4)], colors[expectedColors[index]!]);
    });
  });
}
