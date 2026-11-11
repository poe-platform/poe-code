import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and complete rawvideo output.
for (const [scale, exitCode] of [
  ["-1", 222], ["32768", 222], ["1/0", 222], ["inf", 222],
  ["-inf", 222], ["0/0", 234], ["1", 0]
] as const) {
  it(`tmix scale=${scale} matches native status and raw output`, async () => {
    const input = Buffer.from("1160affe4d9ceb3a89d82776c51463b2", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const argumentValues = createCommandArguments([
      "-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "2x2", "-framerate", "1", "-i", "/in.raw",
      "-vf", `tmix=frames=2:scale=${scale}`, "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"
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
    assert.equal(result.exitCode, exitCode, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stdout).toString("hex"), exitCode === 0 ? "22c0ffff5efcffffd6ffffb0ffec8aff" : "");
    assert.equal(Buffer.concat(stderr).length === 0, exitCode === 0);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
