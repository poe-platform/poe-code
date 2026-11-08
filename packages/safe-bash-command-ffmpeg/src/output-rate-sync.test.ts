import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const options of [
  ["-r", "4", "-fps_mode", "passthrough"],
  ["-r", "4", "-fps_mode", "vfr"],
  ["-fps_mode", "drop", "-r", "4"],
  ["-r", "4", "-vsync", "0"],
  ["-r", "4", "-vsync", "2"],
  ["-r", "4", "-fps_mode", "cfr"],
  ["-r", "4", "-fps_mode", "auto"],
  ["-r", "4"],
  ["-fps_mode", "passthrough"],
]) {
  const invalid = options.includes("-r") && ["passthrough", "vfr", "drop", "0", "2"].some(mode => options.includes(mode));
  it(`output rate and sync: ${options.join(" ")}`, async () => {
    const volume = new Volume();
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
    colors.forEach((color, index) => volume.writeFileSync(`/f${index}.png`, encodeImage({
      width: 2, height: 2, data: new Uint8Array([...color, ...color, ...color, ...color]),
      format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data));
    volume.writeFileSync("/o000.png", volume.readFileSync("/f2.png"));
    const before = volume.toJSON();
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error",
        "-framerate", "2", "-i", "/f%d.png", ...options,
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
    if (invalid) {
      assert.equal(result.exitCode, 234);
      assert.ok(stderr.includes("non-CFR"), stderr);
      assert.deepEqual(volume.toJSON(), before);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    const count = options.includes("-r") ? 6 : 3;
    assert.equal(volume.readdirSync("/").length, 3 + count);
    for (let index = 0; index < count; index++) {
      const image = decodeImage(volume.readFileSync(`/o00${index}.png`) as Buffer);
      assert.deepEqual([...image.data.slice(0, 4)], colors[Math.floor(index * 3 / count)]);
    }
  });
}

it("sync execution defers sync modes to validated async execution", () => {
  for (const option of ["-fps_mode", "-vsync"]) {
    assert.equal(evalSyncFfmpeg(["-i", "/in.png", "-r", "4", option, "passthrough", "/out.png"],
      undefined, () => { throw new Error("must defer before reading input"); },
      () => { throw new Error("must not write output"); }), undefined);
  }
});
