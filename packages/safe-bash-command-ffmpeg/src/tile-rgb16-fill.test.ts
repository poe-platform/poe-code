import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

for (const format of ["rgb48le", "rgb48be", "rgba64le", "rgba64be"]) {
  const channels = format.startsWith("rgba") ? 4 : 3;
  for (const [color, pixel] of [
    ["black", "000000000000ffff"],
    ["red", "ffff00000000ffff"],
    ["0x12345678", "1212343456567878"]
  ]) {
    it(`fills unused ${format} tile cells with exact ${color} components`, async () => {
      const input = Buffer.alloc(4 * channels * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const argumentValues = createCommandArguments([
        "-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo",
        "-pixel_format", format, "-video_size", "2x2", "-framerate", "4",
        "-i", "/in.raw", "-vf", `tile=2x1:color=${color}`,
        "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"
      ]);
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      // Native FFmpeg repeats each color byte into a 16-bit RGB(A) word.
      const fill = Buffer.from(pixel!.slice(0, channels * 4), "hex");
      const blackRow = input.subarray(0, channels * 4);
      const expected = Buffer.concat([blackRow, fill, fill, blackRow, fill, fill]);
      assert.equal(Buffer.concat(output).toString("hex"), expected.toString("hex"));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
