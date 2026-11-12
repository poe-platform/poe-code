import assert from "node:assert/strict";
import { it } from "node:test";
import { inflateSync } from "node:zlib";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const output of sync ? ["file", "sequence"] : ["file", "sequence", "pipe"]) {
  for (const [pred, filters] of [
    [undefined, [0, 0, 0, 0]], ["none", [0, 0, 0, 0]],
    ["sub", [1, 1, 1, 1]], ["up", [1, 2, 2, 2]],
    ["avg", [1, 3, 3, 3]], ["paeth", [1, 4, 4, 4]], ["mixed", [1, 4, 4, 4]],
    ["0", [0, 0, 0, 0]], ["4", [1, 4, 4, 4]], ["5", [1, 4, 4, 4]]
  ] as const) {
    it(`PNG prediction ${pred}, sync=${sync}, output=${output}`, async () => {
      const input = Uint8Array.from({ length: 96 }, (_, i) =>
        (Math.floor(i / 3) % 8 * 23 + Math.floor(i / 24) * 41 + i % 3 * 53) % 256);
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      volume.writeFileSync("/in.png", encodeImage({ width: 8, height: 4, channels: 4,
        data: Uint8Array.from({ length: 128 }, (_, i) => i % 4 === 3 ? 255 : input[Math.floor(i / 4) * 3 + i % 4]!),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png", forceOpaque: true }).data);
      const args = ["-v", "error", ...(sync ? ["-i", "/in.png"] :
        ["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "8x4", "-i", "/in.raw"]), "-frames:v", "1", "-c:v", "png", ...(pred === undefined ? [] : ["-pred", pred]),
        ...(output === "pipe" ? ["-f", "image2pipe", "pipe:1"] : [output === "sequence" ? "/out%d.png" : "/out.png"])];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
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
          stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { volume.writeFileSync("/out.png", bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const png = volume.readFileSync(output === "sequence" ? "/out1.png" : "/out.png") as Buffer;
      const idat: Buffer[] = [];
      for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
        offset += length + 12;
      }
      const channels = png[25] === 6 ? 4 : 3;
      const rows = inflateSync(Buffer.concat(idat));
      assert.deepEqual(Array.from({ length: 4 }, (_, y) => rows[y * (8 * channels + 1)]), filters);
      const decoded = decodeImage(png).data;
      assert.deepEqual(Uint8Array.from({ length: 96 }, (_, i) => decoded[Math.floor(i / 3) * 4 + i % 3]!), input);
    });
  }
}
}

for (const pred of ["invalid", "-1", "6", "1.5", ""]) {
  it(`rejects invalid PNG prediction ${JSON.stringify(pred)} without replacing output`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-pred", pred, "-f", "lavfi", "-i", "color=s=8x4", "-frames:v", "1", "/out.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async writeFile() { assert.fail("must not write output"); } },
      stdin: (async function* () {})(), stdout: { async write() { assert.fail("must not write output"); } },
      stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("Invalid PNG prediction"), stderr);
  });
}
