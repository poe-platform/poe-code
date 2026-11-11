import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [stack, expected] of [
  ["hstack=shortest=1", "10106060101060602020707020207070"],
  ["vstack=shortest=1", "10101010606060602020202070707070"],
  ["xstack=layout=0_0|w0+2_0:fill=black:shortest=1", "101000006060101000006060202000007070202000007070"]
]) {
  for (const branch of ["", "[1:v]null[b];", "[1:v]setpts=PTS[b];", "[0:v]setpts=PTS[a];"]) {
    it(`${stack} preserves the shorter input's final frame with ${branch || "direct inputs"}`, async () => {
      const volume = Volume.fromJSON({
        "/a.gray": Buffer.from([16, 32, 48, 64].flatMap(value => Array(4).fill(value))),
        "/b.gray": Buffer.from([96, 112].flatMap(value => Array(4).fill(value)))
      });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error",
          "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2", "-framerate", "4", "-i", "/a.gray",
          "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2", "-framerate", "4", "-i", "/b.gray",
          "-filter_complex", `${branch}${branch.includes("[a]") ? "[a]" : "[0:v]"}${branch.includes("[b]") ? "[b]" : "[1:v]"}${stack}[out]`,
          "-map", "[out]", "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
