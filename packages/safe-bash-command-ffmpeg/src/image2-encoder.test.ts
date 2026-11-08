import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const codec of ["invented_xyz", "png"]) {
    it(`validates image2 encoder ${codec} before writing (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/bad01.png": "keep" });
      const colors = [[255, 0, 0, 255], [0, 0, 255, 255]];
      for (const [index, color] of colors.entries()) {
        volume.writeFileSync(`/in${index + 1}.png`, encodeImage({
          width: 1, height: 1, data: Uint8Array.from(color), channels: 4,
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data);
      }
      const args = ["-y", "-v", "error", "-i", sync ? "/in1.png" : "/in%d.png", "-c:v", codec, "-f", "image2", "/bad%02d.png"];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, codec === "png" ? "" : undefined);
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
        assert.equal(result.exitCode, codec === "png" ? 0 : 8, stderr);
        if (codec !== "png") assert.ok(stderr.includes("Unknown encoder 'invented_xyz'"), stderr);
      }
      if (codec === "png") {
        for (const [index, color] of (sync ? colors.slice(0, 1) : colors).entries()) {
          assert.deepEqual([...decodeImage(volume.readFileSync(`/bad0${index + 1}.png`) as Buffer).data], color);
        }
      } else {
        assert.equal(volume.readFileSync("/bad01.png", "utf8"), "keep");
        assert.equal(volume.existsSync("/bad02.png"), false);
      }
    });
  }
}
