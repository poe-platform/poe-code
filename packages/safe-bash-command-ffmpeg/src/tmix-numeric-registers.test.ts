import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Complete raw gray output from Linux FFmpeg 7.0.2, including the literal control.
for (const options of [
  "frames=st(0\\,2)",
  "frames=2:scale=ld(0)",
  "frames=2:scale=none",
  "frames=2:scale=0",
  "frames=st(0\\,2):scale=ld(0)",
  "frames=2:scale=st(0\\,0.5)+ld(0)-0.5"
]) {
  it(`evaluates tmix numeric registers independently: ${options}`, async () => {
    const input = Buffer.from("1160affe4d9ceb3a89d82776c51463b2", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const argumentValues = createCommandArguments([
      "-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
      "-framerate", "1", "-i", "/in.raw", "-vf", `tmix=${options}`,
      "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"
    ]);
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stderr).toString(), "");
    assert.equal(Buffer.concat(stdout).toString("hex"), "1160affe2f7ecd9c6bba8958a7764594");
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
