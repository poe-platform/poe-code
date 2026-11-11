import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "61ea53c3459c37750d000d000d000d000d000d000d000d00";
// Native Linux FFmpeg 7.0.2: three 2x2 gray16le frames at 1 fps.
const decayed = "61ea53c3459c37753075aa61224e9c3a983ad53011274e1d";

for (const format of ["gray16le", "gray16be", "gray"]) {
  const source = Buffer.from(format === "gray" ? "c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a" : input, "hex");
  if (format === "gray16be") source.swap16();
  for (const [filter, hex] of [
    ["null", source.toString("hex")],
    ["lagfun=decay=0.5", format === "gray" ? "c8b4a08c645a5046322d282319161412"
      : format === "gray16be" ? Buffer.from(decayed, "hex").swap16().toString("hex") : decayed],
    ["lagfun=planes=0", source.toString("hex")],
    ["lagfun=decay=0", source.toString("hex")],
    ["lagfun=decay=1", source.subarray(0, format === "gray" ? 4 : 8).toString("hex").repeat(format === "gray" ? 4 : 3)]
  ] as const) {
    it(`preserves full ${format} samples through ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": source });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
          "-framerate", "1", "-i", "/in.raw", "-vf", filter, "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout.push(data); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(Buffer.concat(stdout).toString("hex"), hex);
      assert.deepEqual(volume.readFileSync("/in.raw"), source);
    });
  }
}
