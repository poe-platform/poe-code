import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const frames = [[12, 80, 200], [120, 160, 100], [230, 100, 50], [70, 40, 250], [100, 60, 90], [40, 220, 30]];
const mixed = [[12, 80, 200], [66, 120, 150], [175, 130, 75], [150, 70, 150], [85, 50, 170], [70, 140, 60]];

// Linux FFmpeg 7.0.2 reference statuses and complete YUV444 output.
for (const [option, expected] of [
  ["scale=", null],
  ["planes=", null],
  ["weights=", mixed],
  ["scale=0", mixed],
  ["planes=0", [frames[0]!, ...frames.slice(0, -1)]]
] as const) {
  it(`tmix ${option} matches native status and complete output`, async () => {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
      ...frames.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.map(value => Buffer.alloc(4, value))])
    ]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
    const before = volume.toJSON();
    let stderr = "";
    const argumentValues = createCommandArguments([
      "-v", "error", "-y", "-i", "/in.y4m", "-vf", `tmix=frames=2:${option}`,
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
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, expected === null ? 234 : 0, stderr);
    if (expected === null) {
      assert.deepEqual(volume.toJSON(), before);
      assert.ok(stderr.includes("tmix:"), stderr);
    } else {
      assert.deepEqual(volume.readFileSync("/out.raw"),
        Buffer.concat(expected.flatMap(frame => frame.map(value => Buffer.alloc(4, value)))));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    }
  });
}
