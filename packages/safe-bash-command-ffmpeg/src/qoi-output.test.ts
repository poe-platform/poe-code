import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const nativeFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

for (const numbered of [false, true]) {
for (const sync of [false, true]) {
  for (const alpha of [false, true]) {
    for (const explicit of [false, true]) {
      it(`encodes QOI with exact pixels (sync=${sync}, alpha=${alpha}, explicit=${explicit}, numbered=${numbered})`, async () => {
        const pixels = Uint8Array.from(Buffer.from("123456ff133557ff133557ffabcdef80123456ffabcdef00808080ff000000ff", "hex"));
        if (!alpha) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
        const png = encodeImage({ width: 4, height: 2, data: pixels, format: "raw", space: "srgb", channels: alpha ? 4 : 3, depth: "uchar", hasAlpha: alpha, density: 72 }, { format: "png", pngCoder: alpha ? "png32" : "png24" }).data;
        const volume = Volume.fromJSON({ "/in.png": Buffer.from(png) });
        const args = ["-y", "-v", "error", "-i", "/in.png", ...(explicit ? ["-c:v", "qoi"] : []), numbered ? "/out%d.qoi" : "/out.qoi"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), numbered ? "" : undefined);
          if (!numbered) assert.equal(volume.existsSync("/out.qoi"), false);
        }
        if (!sync || !numbered) {
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
        const bytes = volume.readFileSync(numbered ? "/out1.qoi" : "/out.qoi") as Buffer;
        assert.deepEqual([...bytes.subarray(0, 14)], [113, 111, 105, 102, 0, 0, 0, 4, 0, 0, 0, 2, alpha ? 4 : 3, 0]);
        assert.deepEqual([...bytes.subarray(-8)], [0, 0, 0, 0, 0, 0, 0, 1]);
        // Native decoding independently checks all QOI opcodes and transparent RGB.
        if (nativeFfmpeg) {
          const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"], { input: bytes });
          assert.equal(decoded.status, 0, decoded.stderr.toString());
          assert.deepEqual(new Uint8Array(decoded.stdout), pixels);
        }
      });
    }
  }
}
}
