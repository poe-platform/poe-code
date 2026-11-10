import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const frames = [[12, 80, 200], [120, 160, 100], [230, 100, 50], [70, 40, 250], [100, 60, 90], [40, 220, 30]];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...frames.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame.flatMap(value => Array<number>(4).fill(value)))])
]);
// Complete Linux FFmpeg 7.0.2 reference frames, before expanding each 2x2 plane.
const mixed = [[12, 80, 200], [66, 120, 150], [175, 130, 75], [150, 70, 150], [85, 50, 170], [70, 140, 60]];
const luma = [[12, 80, 200], [66, 80, 200], [175, 160, 100], [150, 100, 50], [85, 40, 250], [70, 60, 90]];
const oldest = [frames[0]!, ...frames.slice(0, -1)];
const withoutU = [[12, 80, 200], [66, 80, 150], [175, 160, 75], [150, 100, 150], [85, 40, 170], [70, 60, 60]];

for (const [planes, expected] of [
  ["+1", mixed], ["1+1", luma], ["none", oldest], ["-2", withoutU],
  ["15", mixed], ["1", luma], ["0", oldest],
  ["all", mixed], ["default", mixed], ["min", oldest], ["max", mixed],
  ["-1", [[12, 80, 200], [12, 120, 150], [120, 130, 75], [230, 70, 150], [70, 50, 170], [100, 140, 60]]],
  ["all-2", withoutU], ["none+1", luma], ["1-1+1", luma], ["-all", oldest],
  ["0xF", mixed], ["4294967295", mixed], ["16", oldest], ["2147483648", oldest],
  ["1:planes=+1", luma], ["1:planes=-1", oldest], ["1++0", luma],
  ["", 234], ["+", 234], ["1+", 234], ["no", 234], ["1|2", 234],
  ["1.5", 222], ["4294967296", 222], ["+4294967296", 222]
] as const) {
  for (const mode of planes === "" ? ["simple", "graph"] : ["simple", "graph", "positional"]) {
    it(`tmix plane flags ${planes} preserve native status and all bytes (${mode})`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      const errors: Uint8Array[] = [];
      const filter = mode === "positional" ? `tmix=2:1:0:${planes}` : `tmix=frames=2:planes=${planes}`;
      const argumentValues = createCommandArguments([
        "-v", "error", "-y", "-i", "/in.y4m",
        ...(mode === "graph" ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
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
      assert.equal(result.exitCode, typeof expected === "number" ? expected : 0, Buffer.concat(errors).toString());
      if (typeof expected === "number") {
        assert.equal(volume.readFileSync("/out.raw").toString(), "KEEP");
      } else assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected.flatMap(frame =>
        frame.flatMap(value => Array<number>(4).fill(value)))));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
