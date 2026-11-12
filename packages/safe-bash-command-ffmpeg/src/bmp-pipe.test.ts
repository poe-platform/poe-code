import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const rgb = Uint8Array.from({ length: 45 }, (_, i) =>
  (31 * (Math.floor(i / 3) % 5) + 47 * Math.floor(i / 15) + 59 * (i % 3)) % 256);
const frames = [rgb, rgb.slice().reverse()];
const packets = frames.map(data => encodeImage({
  width: 5, height: 3, channels: 4,
  data: Uint8Array.from({ length: 60 }, (_, i) => i % 4 === 3 ? 255 : data[Math.floor(i / 4) * 3 + i % 4]!),
  format: "bmp", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
}, { format: "bmp" }).data);

for (const source of ["/input.bmp", "pipe:0"]) {
  for (const mode of ["single", "pair", "explicit", "trimmed", "copy", "truncated", "limited", "wrong-format"] as const) {
    it(`decodes bmp_pipe ${source}: ${mode}`, async () => {
      const stream = Buffer.concat(mode === "single" ? packets.slice(0, 1) : packets);
      const input = mode === "truncated" ? stream.subarray(0, stream.length - 1)
        : mode === "wrong-format" ? Buffer.from("P6\n1 1\n255\nRGB") : stream;
      const volume = Volume.fromJSON({ "/input.bmp": input });
      const args = ["-v", "error", "-f", "bmp_pipe",
        ...(mode === "explicit" ? ["-c:v", "bmp"] : []),
        ...(mode === "trimmed" ? ["-framerate", "2"] : []), "-i", source,
        ...(mode === "trimmed" ? ["-ss", "0.5", "-t", "0.5"] : []),
        ...(mode === "copy" ? ["-c:v", "copy"] : []),
        "-pix_fmt", "rgb24", "-f", mode === "copy" ? "image2pipe" : "rawvideo", "pipe:1"];
      assert.equal(evalSyncFfmpeg(input, args,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        () => { assert.fail("bmp_pipe must use the asynchronous demuxer"); }), undefined);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand({ limits: mode === "limited" ? { maxFrames: 1 } : undefined }).execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {
          for (let offset = 0; offset < input.length; offset += 7) yield input.subarray(offset, offset + 7);
        })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (mode === "truncated" || mode === "limited" || mode === "wrong-format") {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes(mode === "limited" ? "maxFrames" : "Invalid or truncated image2pipe bmp frame"), stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(Buffer.concat(stdout), mode === "copy" ? stream
          : Buffer.concat(mode === "single" ? frames.slice(0, 1) : mode === "trimmed" ? frames.slice(1) : frames));
      }
    });
  }
}
