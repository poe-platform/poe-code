import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["hstack", "vstack"] as const) {
  for (const valid of [false, true]) {
    for (const existing of [false, true]) {
      it(`${filter} ${valid ? "accepts matching" : "rejects mismatched"} dimensions with ${existing ? "existing" : "new"} output`, async () => {
        const volume = Volume.fromJSON({});
        const sideWidth = valid && filter === "vstack" ? 8 : 4;
        const sideHeight = valid && filter === "hstack" ? 8 : 6;
        for (const [path, width, height, color] of [
          ["/base.png", 8, 8, [255, 0, 0, 255]],
          ["/side.png", sideWidth, sideHeight, [0, 255, 0, 255]]
        ] as const) {
          const data = new Uint8Array(width * height * 4);
          for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset);
          volume.writeFileSync(path, encodeImage({
            width, height, channels: 4, data, format: "png", space: "srgb",
            depth: "uchar", density: 72, hasAlpha: true
          }, { format: "png" }).data);
        }
        const original = Buffer.from("existing output must survive failure");
        if (existing) volume.writeFileSync("/output.png", original);
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/base.png", "-i", "/side.png",
            "-filter_complex", `[0:v][1:v]${filter}=inputs=2`, "-frames:v", "1", "-update", "1", "/output.png"],
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
          assert.notEqual(result.exitCode, 0);
          const axis = filter === "hstack" ? "height" : "width";
          const size = filter === "hstack" ? sideHeight : sideWidth;
          assert.ok(stderr.includes(`Input 1 ${axis} ${size} does not match input 0 ${axis} 8`), stderr);
          if (existing) assert.deepEqual(volume.readFileSync("/output.png"), original);
          else assert.equal(volume.existsSync("/output.png"), false);
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const output = decodeImage(volume.readFileSync("/output.png") as Buffer);
        assert.equal(output.width, filter === "hstack" ? 12 : 8);
        assert.equal(output.height, filter === "hstack" ? 8 : 14);
        for (let y = 0; y < output.height; y++) {
          for (let x = 0; x < output.width; x++) {
            const base = filter === "hstack" ? x < 8 : y < 8;
            const offset: number = (y * output.width + x) * 4;
            assert.deepEqual([...output.data.subarray(offset, offset + 4)], base ? [255, 0, 0, 255] : [0, 255, 0, 255]);
          }
        }
      });
    }
  }
}
