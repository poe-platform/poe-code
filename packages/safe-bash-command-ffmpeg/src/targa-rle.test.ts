import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const rgba = Buffer.from(Array.from({ length: 72 }, (_, i) => {
  const y = Math.floor(i / 24);
  const block = Math.floor((i % 24) / 8);
  return [33 + 70 * y, 17 + 65 * block, 128 - 24 * y, 32 + 64 * block];
}).flat());

// Native FFmpeg: validate the range before rounding to the nearest even integer.
for (const [value, status, type] of [
  ["0", 0, 2], ["1", 0, 10], ["0.0", 0, 2], ["1.0", 0, 10],
  ["1-1", 0, 2], ["1/2", 0, 2], ["3/4", 0, 10],
  ["default", 0, 10], ["min", 0, 2], ["max", 0, 10],
  ["-1", 222, undefined], ["2", 222, undefined], ["bad", 234, undefined],
  ["-0.1", 222, undefined], ["1.1", 222, undefined]
] as const) {
  it(`encodes Targa -rle ${value} with native status and compression`, async () => {
    const fs = Volume.fromJSON({ "/in.rgba": rgba, "/out1.tga": "keep" });
    const args = ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "24x3",
      "-i", "/in.rgba", "-frames:v", "1", "-c:v", "targa", "-rle", value, "-f", "image2pipe"];
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: [...args, "pipe:1"], cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(),
      stdout: { async write(b: Uint8Array) { stdout.push(b); } },
      stderr: { async write(b: Uint8Array) { stderr.push(b); } }
    } as never);
    assert.equal(result.exitCode, status, Buffer.concat(stderr).toString());
    const output = Buffer.concat(stdout);
    if (status === 0) {
      assert.equal(output[2], type);
      assert.equal(output.readUInt16LE(12), 24);
      assert.equal(output.readUInt16LE(14), 3);
    } else {
      assert.equal(output.length, 0);
      assert.ok(stderr.length);
    }
    fs.writeFileSync("/in.png", encodeImage({
      width: 24, height: 3, channels: 4, data: rgba,
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data);
    const sync = evalSyncFfmpeg(["-i", "/in.png", "-frames:v", "1", "-c:v", "targa", "-rle", value, "/out%d.tga"], undefined,
      p => fs.existsSync(p) ? fs.readFileSync(p) as Buffer : undefined,
      (p, b) => { fs.writeFileSync(p, b); return true; });
    if (status === 0) {
      assert.equal(sync, "");
      assert.deepEqual(fs.readFileSync("/out1.tga"), output);
    } else {
      assert.equal(sync, undefined);
      assert.equal(fs.readFileSync("/out1.tga", "utf8"), "keep");
    }
  });
}
