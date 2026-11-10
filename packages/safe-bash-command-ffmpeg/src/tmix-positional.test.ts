import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const samples = [[12, 80, 200], [120, 160, 100], [230, 100, 50], [70, 40, 250], [100, 60, 90], [40, 220, 30]];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.map(value => Buffer.alloc(4, value))])
]);
const average = [[12, 80, 200], [66, 120, 150], [175, 130, 75], [150, 70, 150], [85, 50, 170], [70, 140, 60]];
const sum = [[24, 160, 255], [132, 240, 255], [255, 255, 150], [255, 140, 255], [170, 100, 255], [140, 255, 120]];
const doubledSum = [[48, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 200, 255], [255, 255, 240]];

// Complete FFmpeg 7.0.2 reference output, including startup padding and clipping.
for (const [options, expected] of [
  ["frames=2:weights=1:2", average],
  ["frames=2:scale=1:2", sum],
  ["frames=2:weights=1:scale=2", doubledSum],
  ["frames=2", average],
  ["2:1:2", doubledSum]
] as const) {
  it(`binds tmix positional options after named options: ${options}`, async () => {
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments([
      "-v", "error", "-y", "-i", "/in.y4m", "-vf", `tmix=${options}`,
      "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"
    ]);
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(volume.readFileSync("/out.raw"),
      Buffer.concat(expected.flatMap(frame => frame.map(value => Buffer.alloc(4, value)))));
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  });
}
