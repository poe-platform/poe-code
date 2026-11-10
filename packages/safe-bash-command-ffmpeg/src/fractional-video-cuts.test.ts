import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = (value: number) => Buffer.from([...Array<number>(4).fill(value), ...Array<number>(8).fill(128)]);
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...[32, 52, 72, 92, 112, 132].flatMap(value => [Buffer.from("FRAME\n"), frame(value)])]);

// Native FFmpeg 7.0.2 rounds the end to input/filter ticks, with half ticks rounding up.
for (const filtering of ["none", "simple", "graph", "fps", "fps-graph"]) {
  for (const inputOption of [false, true]) {
    if (inputOption && filtering.startsWith("fps")) continue;
    for (const option of ["-t", "-to"]) {
      for (const [end, expected] of [["0.26", [32]], ["0.375", [32, 52]], ["0.5", [32, 52]]] as const) {
        it(`${filtering} ${inputOption ? "input" : "output"} ${option} ${end} cuts at the rounded frame boundary`, async () => {
          const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
          let stderr = "";
          const cut = [option, end];
          const filter = filtering.startsWith("fps") ? "fps=8" : "null";
          const filterArgs = filtering === "none" ? [] : filtering.includes("graph")
            ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter];
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-y", ...(inputOption ? cut : []), "-i", "/in.y4m",
              ...filterArgs,
              ...(!inputOption ? cut : []), "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
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
          const values = filtering.startsWith("fps")
            ? end === "0.26" ? [32, 32] : end === "0.375" ? [32, 32, 52] : [32, 32, 52, 52] : expected;
          assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(values.map(frame)));
          assert.deepEqual(volume.readFileSync("/in.y4m"), input);
        });
      }
    }
  }
}
