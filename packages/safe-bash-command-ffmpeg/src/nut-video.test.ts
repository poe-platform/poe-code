import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native packed RGB/BGR NUT clips contain the same 72 RGB bytes at 5 fps.
for (const input of ["rgb", "bgr"]) for (const sync of [false, true]) {
  for (const output of sync ? ["png"] : ["raw", "cut", "png"]) {
    it(`converts NUT ${input} to ${output} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.nut", readFileSync(new URL(`../../mp4-ast/src/fixtures/${input}.nut`, import.meta.url)));
      const args = ["-v", "error", "-y", "-i", "/in.nut", "-an",
        ...(output === "cut" ? ["-ss", "0.2", "-t", "0.4"] : []),
        ...(output === "png" ? ["-frames:v", "1", "-c:v", "png", "-f", "image2"] : ["-pix_fmt", "rgb24", "-f", "rawvideo"]), "/output"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
      const bytes = volume.readFileSync("/output") as Buffer;
      const rgb = Uint8Array.from({ length: 72 }, (_, i) => (i * 7 + 11) % 256);
      if (output === "png") {
        const image = decodeImage(bytes);
        assert.deepEqual([image.width, image.height], [3, 2]);
        assert.deepEqual([...image.data], Array.from({ length: 24 }, (_, i) =>
          i % 4 === 3 ? 255 : rgb[Math.floor(i / 4) * 3 + i % 4]));
      } else assert.deepEqual(new Uint8Array(bytes), output === "cut" ? rgb.subarray(18, 54) : rgb);
    });
  }
}
