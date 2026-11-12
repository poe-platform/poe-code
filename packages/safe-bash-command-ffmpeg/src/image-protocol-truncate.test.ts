import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const truncate of [undefined, "0", "1"]) {
  for (const seedSize of [0, 16, 512]) {
    for (const copy of [false, true]) {
      it(`image2 truncate=${truncate}, existing bytes=${seedSize}, copy=${copy}`, async () => {
        const fs = new Volume();
        fs.writeFileSync("/in.raw", Buffer.from(Array.from({ length: 36 }, (_, i) => i % 3 === 0 ? 32 * (1 + Math.floor(i / 12)) : 0)));
        const png = encodeImage({ width: 2, height: 2, channels: 4,
          data: Uint8Array.from([32, 0, 0, 255, 32, 0, 0, 255, 32, 0, 0, 255, 32, 0, 0, 255]),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        fs.writeFileSync("/in.png", png);
        if (seedSize) fs.writeFileSync("/out.png", Buffer.alloc(seedSize, 83));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", ...(copy ? ["-i", "/in.png", "-c:v", "copy"] :
            ["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2", "-framerate", "3", "-i", "/in.raw", "-c:v", "png"]),
          "-f", "image2", "-frames:v", "1", ...(truncate === undefined ? [] : ["-protocol_opts", `truncate=${truncate}`]), "/out.png"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = fs.readFileSync("/out.png") as Buffer;
        assert.deepEqual([...decodeImage(output).data.slice(0, 4)], [32, 0, 0, 255]);
        const end = output.indexOf(Buffer.from("IEND")) + 8;
        assert.ok(end > 8 && end < 512);
        assert.equal(output.length, truncate === "0" ? Math.max(seedSize, end) : end);
        assert.deepEqual(output.subarray(end), Buffer.alloc(output.length - end, 83));
        if (copy) assert.deepEqual(output.subarray(0, end), Buffer.from(png));
      });
    }
  }
}
