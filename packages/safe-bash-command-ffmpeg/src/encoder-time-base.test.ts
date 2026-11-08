import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [option, mode, valid] of [
  ["-enc_time_base", "1:1000", true],
  ["-enc_time_base:v:0", "1:4", true],
  ["-enc_time_base", "1/4", true],
  ["-enc_time_base", "0", true],
  ...["bad", "1:0", "", "1:2:3"].map(value => ["-enc_time_base", value, false] as const)
] as const) {
  it(`${option} ${JSON.stringify(mode)} ${valid ? "writes frames" : "preserves all files"}`, async () => {
    const volume = Volume.fromJSON({});
    for (const [index, rgb] of [[255, 0, 0], [0, 255, 0], [0, 0, 255]].entries()) {
      const data = new Uint8Array(8 * 8 * 4);
      for (let offset = 0; offset < data.length; offset += 4) data.set([...rgb, 255], offset);
      volume.writeFileSync(`/f${index}.png`, encodeImage({ width: 8, height: 8, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    volume.writeFileSync("/o000.png", volume.readFileSync("/f2.png"));
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-framerate", "2", "-i", "/f%d.png",
        "-fps_mode", "passthrough", option, mode, "-frame_pts", "1", "/o%03d.png", "-fps_mode", "passthrough", "-frame_pts", "1", "/second%03d.png"],
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
    const stderr = Buffer.concat(errors).toString();
    if (!valid) {
      assert.equal(result.exitCode, 234, stderr);
      assert.ok(stderr.includes("enc_time_base"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Object.keys(volume.toJSON()).filter(path => path.startsWith("/second")).sort(),
        ["/second000.png", "/second001.png", "/second002.png"]);
      const paths = Object.keys(volume.toJSON()).filter(path => path.startsWith("/o")).sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)));
      assert.deepEqual(paths, mode === "1:1000" ? ["/o000.png", "/o500.png", "/o1000.png"] : mode === "0" ? ["/o000.png", "/o001.png", "/o002.png"] : ["/o000.png", "/o002.png", "/o004.png"]);
      assert.deepEqual(paths.map(path => [...decodeImage(new Uint8Array(volume.readFileSync(path) as Buffer)).data.slice(0, 3)]),
        [[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
    }
  });
}
