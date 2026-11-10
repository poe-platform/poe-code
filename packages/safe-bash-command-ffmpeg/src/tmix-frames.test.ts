import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const values = [16, 17, 18, 30, 90, 235];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
  ...values.flatMap(value => [Buffer.from("FRAME\n"), Buffer.alloc(4, value), Buffer.alloc(8, 128)])
]);
// Exact raw YUV444 output from Linux FFmpeg 7.0.2.
const twoFrames = [16, 17, 18, 24, 60, 163];
const threeFrames = [16, 16, 17, 22, 46, 118];
for (const [option, expected] of [
  ["frames=2", twoFrames],
  ["frames=1+1", twoFrames],
  ["frames=2.5", twoFrames],
  ["frames=3.5", [16, 16, 17, 20, 39, 93]],
  ["frames=1.5", twoFrames],
  ["frames=2.49", twoFrames],
  ["frames=2.51", threeFrames],
  ["frames=PI", threeFrames],
  ["frames=default", threeFrames],
  ["frames=min", values],
  ["1+1", twoFrames],
  ["3.5", [16, 16, 17, 20, 39, 93]],
  ...["0", "0.99", "1024.01", "1025", "1/0", "0/0", "1+", "2junk", ""].map(value =>
    [`frames=${value}`, null] as const)
] as const) {
  for (const graph of [false, true]) {
    it(`tmix frame count (${graph ? "graph" : "simple"}): ${option}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      const before = volume.toJSON();
      const errors: Uint8Array[] = [];
      const filter = `tmix=${option}`;
      const argumentValues = createCommandArguments(["-v", "error", "-y", "-i", "/in.y4m",
        ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"]);
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
      const stderr = Buffer.concat(errors).toString();
      if (expected === null) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("tmix:"), stderr);
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected.flatMap(value =>
          [Buffer.alloc(4, value), Buffer.alloc(8, 128)])));
        assert.deepEqual(volume.readFileSync("/in.y4m"), input);
      }
    });
  }
}
