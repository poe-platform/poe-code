import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: the escaped clock and 500ms produce these same intervals.
for (const graph of [false, true]) {
  for (const [options, valid] of [
    [String.raw`n=0:d=00\\:00\\:00.500`, true],
    [String.raw`n=0:d='00\:00\:00.500'`, true],
    [String.raw`noise=0:duration=\'00:00:00.500\'`, true],
    [String.raw`0:'00\:00.500'`, true],
    [String.raw`d='00\:00\:00.500':n=0`, true],
    ["n=0:d=500ms", true],
    [String.raw`n=0:d='00\:60\:00.500'`, false],
    [String.raw`n=0:d='-00\:00\:00.500'`, false],
    [String.raw`n=0:d='00\:00\:invalid'`, false]
  ] as const) {
    it(`${graph ? "graph" : "simple"} freezedetect clock duration: ${options}`, async () => {
      const input = Buffer.from("1414141414141414141414181414141814141418fa000018", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const filter = `freezedetect=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "rgba",
          "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      if (!valid) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(stderr.trim(), "ffmpeg: freezedetect: duration must be nonnegative");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), input);
      assert.deepEqual(stderr.trim().split("\n"), [
        "lavfi.freezedetect.freeze_start: 0",
        "lavfi.freezedetect.freeze_duration: 0.5",
        "lavfi.freezedetect.freeze_end: 0.5",
        "lavfi.freezedetect.freeze_start: 0.5",
        "lavfi.freezedetect.freeze_duration: 0.75",
        "lavfi.freezedetect.freeze_end: 1.25"
      ]);
    });
  }
}
