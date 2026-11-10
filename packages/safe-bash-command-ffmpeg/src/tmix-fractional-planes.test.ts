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

// Linux FFmpeg 7.0.2 reference status and complete output, including both valid controls.
for (const [planes, expected] of [
  ["1.5", 222],
  ["1.0", [[12, 80, 200], [66, 80, 200], [175, 160, 100], [150, 100, 50], [85, 40, 250], [70, 60, 90]]],
  ["2", [[12, 80, 200], [12, 120, 200], [120, 130, 100], [230, 70, 50], [70, 50, 250], [100, 140, 90]]]
] as const) {
  for (const graph of [false, true]) {
    it(`tmix planes=${planes} preserves native status and complete output (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      let stderr = "";
      const filter = `tmix=frames=2:planes=${planes}`;
      const argumentValues = createCommandArguments([
        "-v", "error", "-y", "-i", "/in.y4m",
        ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
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
      assert.deepEqual(volume.readFileSync("/out.raw"), typeof expected === "number" ? Buffer.from("KEEP") :
        Buffer.from(expected.flatMap(frame => frame.flatMap(value => Array<number>(4).fill(value)))));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
      assert.equal(result.exitCode, typeof expected === "number" ? expected : 0, stderr);
    });
  }
}
