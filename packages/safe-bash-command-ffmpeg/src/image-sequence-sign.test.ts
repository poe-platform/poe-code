import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [offset, pattern, filenames] of [
  [-2, "%03d", ["-002", "-001", "000"]],
  [0, "%03d", ["000", "001", "002"]],
  [2, "%03d", ["002", "003", "004"]],
  [-2, "%d", ["-2", "-1", "0"]],
  [-12, "%01d", ["-12", "-11", "-10"]],
] as const) {
  it(`image2 timestamp filenames preserve signs: ${offset}, ${pattern}`, async () => {
    const volume = new Volume();
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    colors.forEach((color, index) => volume.writeFileSync(`/f${index}.png`, encodeImage({
      width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", "1", "-i", "/f%d.png",
        "-vf", `setpts=PTS${offset < 0 ? "" : "+"}${offset}`, "-fps_mode", "passthrough",
        "-frame_pts", "1", `/o${pattern}.png`],
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
      assert.deepEqual([...image.data.slice(0, 4)], colors[index]);
    });
  });
}
