import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [codec, suffix, signature] of [["png", "jpg", "89504e470d0a1a0a"], ["mjpeg", "png", "ffd8"], ["bmp", "jpg", "424d"], ["png", "bin", "89504e470d0a1a0a"], ["png", "tga", "89504e470d0a1a0a"], ["png", "png", "89504e470d0a1a0a"], ["", "jpg", "ffd8"]] as const) {
    it(`selects image2 encoder ${codec || "default"} for .${suffix} (${sync ? "sync" : "async"})`, async () => {
      const volume = new Volume();
      const colors = [[255, 0, 0, 255], [0, 0, 255, 255]];
      for (const [index, color] of colors.entries()) {
        volume.writeFileSync(`/in${index + 1}.png`, encodeImage({
          width: 1, height: 1, data: Uint8Array.from(color), channels: 4,
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data);
      }
      const args = ["-y", "-v", "error", "-i", sync ? "/in1.png" : "/in%d.png", ...(codec ? ["-c:v", codec] : []), "-f", "image2", `/bad%02d.${suffix}`];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      for (let index = 0; index < (sync ? 1 : 2); index++) {
        const bytes = volume.readFileSync(`/bad0${index + 1}.${suffix}`) as Buffer;
        assert.equal(bytes.subarray(0, signature.length / 2).toString("hex"), signature);
      }
    });
  }
}
