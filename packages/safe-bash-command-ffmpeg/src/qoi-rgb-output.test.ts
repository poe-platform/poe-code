import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 outputs for independently constructed QOI inputs.
const rgba = "716f696600000001000000010400ff804020800000000000000001";
const rgb = "716f696600000001000000010300fe8040200000000000000001";
const opaqueRgba = "716f696600000001000000010400fe8040200000000000000001";
const twoRgba = "716f696600000002000000010400ff80402080ff1248aaff0000000000000001";
const twoRgb = "716f696600000002000000010300fe804020fe1248aa0000000000000001";

for (const fixture of [
  { name: "drops one pixel's alpha", input: rgba, options: ["-pix_fmt", "rgb24"], output: rgb, pixels: "804020ff" },
  { name: "drops alpha from every pixel", input: twoRgba, options: ["-pix_fmt", "rgb24"], output: twoRgb, pixels: "804020ff1248aaff" },
  { name: "adds an opaque alpha channel", input: rgb, options: ["-pix_fmt", "rgba"], output: opaqueRgba, pixels: "804020ff" },
  { name: "preserves explicit RGBA", input: rgba, options: ["-pix_fmt", "rgba"], output: rgba, pixels: "80402080" },
  { name: "preserves default RGBA", input: rgba, options: [], output: rgba, pixels: "80402080" },
  { name: "preserves default RGB", input: rgb, options: [], output: rgb, pixels: "804020ff" },
  { name: "matches the RGB filter control", input: twoRgba, options: ["-vf", "format=rgb24"], output: twoRgb, pixels: "804020ff1248aaff" },
  { name: "applies output format after filters", input: rgba, options: ["-pix_fmt", "rgba", "-vf", "format=rgb24"], output: opaqueRgba, pixels: "804020ff" }
]) {
  for (const target of ["/out.qoi", "/out%d.qoi", "pipe:1", "/out.bin"]) {
    it(`QOI ${fixture.name} (${target})`, async () => {
      const volume = Volume.fromJSON({ "/in.qoi": Buffer.from(fixture.input, "hex") });
      let stdout = Buffer.alloc(0), stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.qoi", ...fixture.options,
          ...(target === "pipe:1" ? ["-c:v", "qoi", "-f", "image2pipe"] : target === "/out.bin" ? ["-c:v", "qoi", "-f", "image2"] : []), target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout = Buffer.concat([stdout, bytes]); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = target === "pipe:1" ? stdout : volume.readFileSync(target.replace("%d", "1")) as Buffer;
      assert.equal(output[12], Buffer.from(fixture.output, "hex")[12], "QOI channel header");
      assert.equal(output.toString("hex"), fixture.output);
      assert.equal(Buffer.from(decodeImage(output).data).toString("hex"), fixture.pixels);
    });
  }
}

for (const target of ["/out.qoi", "/out%d.qoi"]) {
  it(`defers explicit QOI pixel formats to async encoding (${target})`, () => {
    const volume = Volume.fromJSON({ "/in.qoi": Buffer.from(rgba, "hex") });
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.qoi", "-pix_fmt", "rgb24", target], undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.equal(volume.existsSync(target.replace("%d", "1")), false);
  });
}
