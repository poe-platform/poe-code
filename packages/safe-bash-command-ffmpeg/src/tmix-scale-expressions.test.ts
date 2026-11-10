import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const samples = [[12, 80, 200], [120, 160, 100], [230, 100, 50], [70, 40, 250], [100, 60, 90], [40, 220, 30]];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame.flatMap(value => Array(4).fill(value)))])
]);
const averaged = [[12, 80, 200], [66, 120, 150], [175, 130, 75], [150, 70, 150], [85, 50, 170], [70, 140, 60]];
const clipped = samples.map(() => [255, 255, 255]);

// Linux FFmpeg 7.0.2 reference output, including literal-scale controls.
for (const [scale, expected] of [
  ["1/2", averaged], ["default", averaged], ["1k", clipped],
  ["0.5", averaged], ["0", averaged], ["1e3", clipped],
  ["min", averaged], ["max", clipped], ["500m", averaged],
  ["PI/PI/2", averaged], ["E/E/2", averaged], ["PHI/PHI/2", averaged]
] as const) {
  for (const timed of [false, true]) {
    it(`evaluates tmix scale=${scale} ${timed ? "in a runtime command" : "at initialization"}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      const filter = timed
        ? `sendcmd=c=0 tmix scale ${scale},tmix=frames=2:scale=1`
        : `tmix=frames=2:scale=${scale}`;
      const argumentValues = createCommandArguments([
        "-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"
      ]);
      let stderr = "";
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
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"),
        Buffer.from(expected.flatMap(frame => frame.flatMap(value => Array(4).fill(value)))));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
