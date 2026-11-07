import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sizes of [[16], [32, 16], [256]]) {
  for (const explicit of [false, true]) {
    it(`muxes PNG ICO entries ${sizes} with ${explicit ? "explicit" : "inferred"} format`, async () => {
      const volume = new Volume();
      const inputs = sizes.map((size, index) => {
        const data = new Uint8Array(size * size * 4);
        for (let p = 0; p < data.length; p += 4) data.set([index * 80, 34, 56, p === 0 ? 0 : 255], p);
        const image = { width: size, height: size, data, channels: 4 as const, format: "png" as const,
          space: "srgb" as const, depth: "uchar" as const, density: 72, hasAlpha: true };
        volume.writeFileSync(`/i${index}.png`, encodeImage(image, { format: "png" }).data);
        return image;
      });
      const args = ["-v", "error", "-y", ...sizes.flatMap((_, i) => ["-i", `/i${i}.png`]),
        ...(sizes.length > 1 ? sizes.flatMap((_, i) => ["-map", `${i}:v`]) : []), "-c:v", "png",
        ...(explicit ? ["-f", "ico"] : []), "/out.ico"];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({ args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { errors.push(data); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const bytes = volume.readFileSync("/out.ico") as Buffer;
      assert.equal(bytes.readUInt16LE(0), 0);
      assert.equal(bytes.readUInt16LE(2), 1);
      assert.equal(bytes.readUInt16LE(4), sizes.length);
      let offset = 6 + sizes.length * 16;
      for (const [i, input] of inputs.entries()) {
        const p = 6 + i * 16;
        assert.equal(bytes[p], input.width % 256);
        assert.equal(bytes[p + 1], input.height % 256);
        assert.equal(bytes.readUInt16LE(p + 4), 1);
        assert.equal(bytes.readUInt16LE(p + 6), 32);
        assert.equal(bytes.readUInt32LE(p + 12), offset);
        const length = bytes.readUInt32LE(p + 8);
        const png = bytes.subarray(offset, offset + length);
        assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        const decoded = decodeImage(png);
        assert.equal(decoded.width, input.width);
        assert.equal(decoded.height, input.height);
        assert.deepEqual(decoded.data, input.data);
        offset += length;
      }
      assert.equal(offset, bytes.length);
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, data) => { volume.writeFileSync(path, data); return true; }), sizes.length > 1 ? undefined : "");
      assert.deepEqual(volume.readFileSync("/out.ico"), bytes);
    });
  }
}

for (const scenario of ["dimensions", "codec", "budget"] as const) {
  it(`rejects invalid ICO ${scenario} without replacing output`, async () => {
    const volume = new Volume();
    volume.writeFileSync("/out.ico", "original");
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand(scenario === "budget" ? { limits: { maxOutputBytes: 10 } } : {}).execute({
      args: ["-y", "-f", "lavfi", "-i", `color=red:s=${scenario === "dimensions" ? "258x16" : "16x16"}:d=0.04`,
        "-c:v", scenario === "codec" ? "jpeg" : "png", "/out.ico"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { errors.push(data); } }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.ok(Buffer.concat(errors).toString().includes(scenario === "dimensions" ? "ICO dimensions" : scenario === "codec" ? "ICO output requires" : "maxOutputBytes"));
    assert.equal(volume.readFileSync("/out.ico", "utf8"), "original");
  });
}
