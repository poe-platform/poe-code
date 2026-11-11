import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Buffer.from("716f696600000002000000010400ff80402080ff1248aaff0000000000000001", "hex");

for (const output of ["/out.qoi", "/out%d.qoi"]) {
  for (const pixelFormat of ["+gray", "+rgb24", "+rgba", "+", "gray"]) {
    it(`honors QOI pixel format ${pixelFormat} for ${output}`, async () => {
      const volume = Volume.fromJSON({ "/in.qoi": input });
      const args = ["-y", "-v", "error", "-i", "/in.qoi", "-pix_fmt", pixelFormat, output];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      const fails = pixelFormat === "+gray" || pixelFormat === "+rgb24";
      assert.equal(result.exitCode, fails ? 234 : 0, stderr);
      if (fails) {
        assert.ok(stderr.includes("automatic conversion is disabled"), stderr);
        assert.deepEqual(volume.toJSON(), { "/in.qoi": input.toString() });
      } else {
        assert.equal(stderr, "");
        const encoded = volume.readFileSync(output === "/out.qoi" ? output : "/out1.qoi") as Buffer;
        if (pixelFormat !== "gray") assert.deepEqual(encoded, input);
        else assert.equal(encoded.subarray(0, 4).toString(), "qoif");
      }
    });
  }
  it(`defers strict pixel formats from synchronous encoding of ${output}`, () => {
    const volume = Volume.fromJSON({ "/in.qoi": input });
    const before = volume.toJSON();
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.qoi", "-pix_fmt", "+gray", output], undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.deepEqual(volume.toJSON(), before);
  });
}
