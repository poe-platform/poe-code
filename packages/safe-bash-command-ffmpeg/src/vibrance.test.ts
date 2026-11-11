import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "0c121c3440488080804182beb48755d7dce1f0a050fcfaf6";

// Complete RGB24 frames from FFmpeg 7.0.2.
for (const [filter, expected] of [
  ["null", input],
  ["vibrance", input],
  ["vibrance=intensity=1.5", "000f291f3e53808080006fffff9600cedae7ffbb00fffbf0"],
  ["vibrance=1.5", "000f291f3e53808080006fffff9600cedae7ffbb00fffbf0"],
  ["vibrance=intensity=-0.8:alternate=1", "1213143f4041808080988b807a7e83dbdcdd7991a9f9f9f8"],
  ["vibrance=intensity=-0.8:alternate=true", "1213143f4041808080988b807a7e83dbdcdd7991a9f9f9f8"],
  ["vibrance=intensity=1.5:rbal=0:gbal=0:bbal=0", input],
  ["vibrance=intensity=3", null],
  ["vibrance=intensity=NaN", null],
  ["vibrance=alternate=invalid", null],
  ["vibrance=rbal=11", null],
  ["vibrance=rlum=-1", null],
  ["vibrance=unknown=1", null]
] as const) {
  for (const format of ["rgb24", "rgba"]) {
    it(`renders ${filter} with native ${format} bytes`, async () => {
      const pack = (hex: string) => Buffer.from(Array.from(Buffer.from(hex, "hex")).flatMap((value, index) =>
        format === "rgba" && index % 3 === 2 ? [value, Math.floor(index / 3) * 31] : [value]));
      const volume = Volume.fromJSON({ "/in.raw": pack(input) });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo",
          "-pixel_format", format, "-video_size", "4x2", "-framerate", "4", "-i", "/in.raw",
          "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.match(stderr, /vibrance/);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(Buffer.concat(stdout).toString("hex"), pack(expected).toString("hex"));
      }
      assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), pack(input).toString("hex"));
    });
  }
}
