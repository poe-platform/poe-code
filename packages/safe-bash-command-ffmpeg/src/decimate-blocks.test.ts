import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const levels = [10, 50, 65, 90, 55, 95, 40, 111, 88];
const wide = [1, 2, 3, 4, 5, 7, 8];
const narrow = [1, 2, 3, 5, 6, 7, 8];

for (const [filter, expected, hash] of [
  ["null", levels.map((_, i) => i), "4a6adbcd6bb6c89f25036fb9cf94c7e141d867884b515c1c85385b70a2e70da4"],
  ["decimate=cycle=4", wide, "74eaedf4275dc9cc9f6c0d48f1faa56f90bccff41fe6da2d0557a9f46813e4ce"],
  ["decimate=cycle=4:blockx=8", narrow, "d3fba39ff8731472c5c37c7c15bca01619412be5dbaa19ed416ddee291e2c160"],
  ["decimate=cycle=4:blocky=8", wide, "74eaedf4275dc9cc9f6c0d48f1faa56f90bccff41fe6da2d0557a9f46813e4ce"],
  ["decimate=cycle=4:blockx=8:blocky=8", narrow, "d3fba39ff8731472c5c37c7c15bca01619412be5dbaa19ed416ddee291e2c160"],
  ["decimate=4:blockx=8", narrow, "d3fba39ff8731472c5c37c7c15bca01619412be5dbaa19ed416ddee291e2c160"]
] as const) {
  for (const transpose of [false, true]) {
    it(`decimate moving bars match native FFmpeg: ${filter}, transpose=${transpose}`, async () => {
      const width = transpose ? 32 : 48, height = transpose ? 48 : 32;
      const frames = levels.map((level, i) => {
        const frame = Buffer.alloc(width * height * 3, 128);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            frame[y * width + x] = 90 + (Math.floor((transpose ? y : x) / 8) === i % 4 ? level : 0);
          }
        }
        return frame;
      });
      const input = Buffer.concat([
        Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C444\n`),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]);
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      const actualFilter = transpose ? filter.replaceAll("blockx", "blockZ").replaceAll("blocky", "blockx").replaceAll("blockZ", "blocky") : filter;
      const argumentValues = createCommandArguments(["-v", "error", "-y", "-i", "/in.y4m", "-vf", actualFilter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"]);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(output, Buffer.concat(expected.map(i => frames[i]!)));
      if (!transpose) assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
