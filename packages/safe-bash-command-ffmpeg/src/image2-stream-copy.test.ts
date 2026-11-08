import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const singleInput of [false, true]) {
  for (const suffix of ["png", "jpg"]) {
    it(`copies original image packets to .${suffix} (${singleInput ? "single input with sync fallback" : "sequence"})`, async () => {
      const volume = Volume.fromJSON({});
      for (const [index, color] of [[255, 0, 0, 255], [0, 0, 255, 255]].entries()) {
        const image = encodeImage({
          width: 1, height: 1, data: Uint8Array.from(color), channels: 4,
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        // Trailing bytes are legal PNG input and expose otherwise identical re-encoding.
        volume.writeFileSync(`/in${index + 1}.png`, Buffer.concat([image, Buffer.from("original packet")]));
      }
      const args = ["-y", "-v", "error", "-i", singleInput ? "/in1.png" : "/in%d.png", "-c:v", "copy", "-f", "image2", `/copy%02d.${suffix}`];
      if (singleInput) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
      }
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
      for (let index = 1; index <= (singleInput ? 1 : 2); index++) {
        assert.deepEqual(volume.readFileSync(`/copy0${index}.${suffix}`), volume.readFileSync(`/in${index}.png`));
      }
    });
  }
}
