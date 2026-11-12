import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: raw RGBA 24x3 -> targa, default or explicit -rle 0|1.
for (const sync of [false, true]) {
  for (const rle of [[], ["-rle", "0"], ["-rle", "1"]]) {
    for (const compressible of [false, true]) {
      it(`uses native Targa storage: sync=${sync}, ${rle.join(" ") || "default"}, compressible=${compressible}`, async () => {
        const rgba = compressible
          ? Uint8Array.from(Array.from({ length: 72 }, (_, i) => {
            const x = i % 24, y = Math.floor(i / 24);
            return [33 + 70 * y, 17 + 65 * Math.floor(x / 8), 128 - 24 * y, 32 + 64 * Math.floor(x / 8)];
          }).flat())
          : Uint8Array.from({ length: 288 }, (_, i) => 43 * i % 256);
        const volume = Volume.fromJSON({ "/in.rgba": Buffer.from(rgba) });
        if (sync) volume.writeFileSync("/in.png", encodeImage({
          width: 24, height: 3, data: rgba, format: "png", space: "srgb", channels: 4,
          depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data);
        const target = sync ? "/out%02d.tga" : "pipe:1";
        const args = ["-v", "error", ...(sync ? ["-i", "/in.png"]
          : ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "24x3", "-i", "/in.rgba"]),
          "-frames:v", "1", "-c:v", "targa", ...rle,
          ...(sync ? [] : ["-f", "image2pipe"]), target];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        const bytes = sync ? volume.readFileSync("/out01.tga") as Buffer : Buffer.concat(stdout);
        const compressed = compressible && rle[1] !== "0";
        assert.equal(bytes[2], compressed ? 10 : 2);
        assert.equal(bytes.length, compressed ? 89 : 332);
        assert.deepEqual(bytes.subarray(-26), Buffer.concat([Buffer.alloc(8), Buffer.from("TRUEVISION-XFILE.\0")]));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), !compressible
          ? "eec981cfdad4b68cc8e6d7b84bf9e4c341be5a1937dcd8466534586f415a2ebd"
          : compressed ? "3f55195e96e989eac0606d1ea5b4f5e29371a60c39bd34a35fbc0943dd1a69a5"
          : "bb296dab8f501bbf2e72aa20958599f3e98226026c2ab28fc2a4ebb2d2c18e9b");
        assert.deepEqual(decodeImage(bytes).data, rgba);
      });
    }
  }
}
