import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const rgba = Buffer.from("ff0000ff00ff00800000ff4000000000", "hex");

for (const codec of ["exr", "png"]) {
  for (const mode of ["stdout", "file", "sequence", "sync"] as const) {
    it(`encodes RGBA with transparency as ${codec} through ${mode} image output`, async () => {
      const volume = Volume.fromJSON({ "/in.rgba": rgba });
      let input = ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-i", "/in.rgba"];
      if (mode === "sync") {
        volume.writeFileSync("/in.png", encodeImage({ width: 2, height: 2, data: rgba,
          channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data);
        input = ["-i", "/in.png"];
      }
      const sequence = mode === "sequence" || mode === "sync";
      const target = mode === "stdout" ? "pipe:1" : sequence ? "/out%02d.bin" : "/out.bin";
      const args = ["-v", "error", ...input, "-frames:v", "1", "-c:v", codec,
        "-f", sequence ? "image2" : "image2pipe", target];
      const stdout: Uint8Array[] = [];
      if (mode === "sync") {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const bytes = mode === "stdout" ? Buffer.concat(stdout)
        : volume.readFileSync(sequence ? "/out01.bin" : target) as Buffer;
      if (codec === "exr") assert.equal(bytes.subarray(0, 4).toString("hex"), "762f3101");
      const image = decodeImage(bytes);
      assert.equal(image.format, codec);
      assert.equal(image.width, 2);
      assert.equal(image.height, 2);
      assert.equal(image.hasAlpha, true);
      assert.deepEqual(Buffer.from(image.data), rgba);
    });
  }
}
