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
const weighted = [[12, 80, 200], [66, 120, 150], [202, 115, 62], [110, 55, 200], [92, 55, 130], [55, 180, 45]];

// Complete rawvideo output captured from Linux FFmpeg 7.0.2.
for (const [filter, expected] of [
  ["sendcmd=c=0.4 tmix weights 1|3,tmix=frames=2", weighted],
  ["sendcmd=c=0.4 tmix@v weights 0|1,tmix@v=frames=2", [...averaged.slice(0, 2), ...samples.slice(2)]],
  ["sendcmd=c=0.4 tmix@v scale 1,tmix@v=frames=2",
    [[12, 80, 200], [66, 120, 150], [255, 255, 150], [255, 140, 255], [170, 100, 255], [140, 255, 120]]],
  ["tmix=frames=2:weights=1 3", [weighted[0]!, [93, 140, 125], ...weighted.slice(2)]],
  ["sendcmd=c=0.41 tmix weights 1|3,tmix=frames=2", [...averaged.slice(0, 3), ...weighted.slice(3)]],
  ["sendcmd=c=0.4 tmix weights 1|3,tmix=frames=2:scale=0.5",
    [[12, 80, 200], [66, 120, 150], [255, 230, 125], [220, 110, 255], [185, 110, 255], [110, 255, 90]]],
  ["sendcmd=c=0.4 tmix@v weights 0|1,tmix@other=frames=1,tmix@v=frames=2",
    [...averaged.slice(0, 2), ...samples.slice(2)]],
  ["sendcmd=c=2 tmix weights 0|1,tmix=frames=2", averaged],
  ["sendcmd=c=0.4 tmix weights nope,tmix=frames=2", averaged]
] as const) {
  it(`matches native timed tmix weights: ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
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
