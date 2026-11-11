import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Expected bytes and metadata verified against native FFmpeg 7.0.2 (AVX2).
for (const [width, height, noise, split] of [
  [1, 1, "0.004", true], [1, 1, "0", true],
  [1, 1, "0.0078", true], [1, 1, "1/128", false],
  [7, 1, "0.004", true], [8, 1, "0.004", false],
  [1, 2, "0.009", true], [1, 2, "0.01", false]
] as const) {
  it(`matches RGBA freeze-end selection for ${width}x${height} at noise=${noise}`, async () => {
    const volume = Volume.fromJSON({});
    const frames = [
      [20, 20, 20, 20], [20, 20, 20, 20], [20, 20, 20, 24],
      [20, 20, 20, 24], [20, 20, 20, 24], [250, 0, 0, 24]
    ].map(pixel => Buffer.from(Array.from({ length: width * height }, () => pixel).flat()));
    volume.writeFileSync("/in.raw", Buffer.concat(frames));
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", `${width}x${height}`, "-framerate", "4", "-i", "in.raw", "-vf",
        `freezedetect=n=${noise}:d=0.5,metadata=select:key=lavfi.freezedetect.freeze_end`,
        "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const error = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, 0, error);
    assert.deepEqual(Buffer.concat(output), Buffer.concat(split ? [frames[2]!, frames[5]!] : [frames[5]!]));
    assert.deepEqual(error.trim().split("\n"), split ? [
      "lavfi.freezedetect.freeze_start: 0",
      "lavfi.freezedetect.freeze_duration: 0.5",
      "lavfi.freezedetect.freeze_end: 0.5",
      "lavfi.freezedetect.freeze_start: 0.5",
      "lavfi.freezedetect.freeze_duration: 0.75",
      "lavfi.freezedetect.freeze_end: 1.25"
    ] : [
      "lavfi.freezedetect.freeze_start: 0",
      "lavfi.freezedetect.freeze_duration: 1.25",
      "lavfi.freezedetect.freeze_end: 1.25"
    ]);
  });
}
