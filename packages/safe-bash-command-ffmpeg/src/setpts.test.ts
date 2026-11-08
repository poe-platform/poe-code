import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [rate, filter, filenames] of [
  [2, "setpts=PTS+2", ["002", "003", "004"]],
  [1, "setpts=PTS+2", ["002", "003", "004"]],
  [4, "setpts=PTS+2", ["002", "003", "004"]],
  [2, "setpts=PTS-2", ["-002", "-001", "000"]],
  [2, "setpts=PTS+2,setpts=PTS-STARTPTS", ["000", "001", "002"]],
  [2, "fps=1,setpts=PTS+2", ["002", "003"]],
] as const) {
  it(`setpts uses time-base ticks at ${rate} fps: ${filter}`, async () => {
    const volume = new Volume();
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    colors.forEach((color, index) => volume.writeFileSync(`/f${index}.png`, encodeImage({
      width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", String(rate), "-i", "/f%d.png",
        "-vf", filter, "-fps_mode", "passthrough",
        "-frame_pts", "1", "/o%03d.png"],
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
      assert.deepEqual([...image.data.slice(0, 4)], colors[filter.startsWith("fps=") ? index * 2 : index]);
    });
  });
}
