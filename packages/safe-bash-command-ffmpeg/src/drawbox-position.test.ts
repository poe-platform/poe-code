import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = Buffer.from("0724415e7b98b5d2ef0c294663809dba", "hex");
const drawn = Buffer.from("0724415e7bffb5d2ef0c294663809dba", "hex");

for (const graph of [false, true]) {
  for (const [prefix, expression, expected] of [
    ["", "gte(pos\\,16)", [frame, drawn, drawn]],
    ["", "gte(n\\,1)", [frame, drawn, drawn]],
    ["", "eq(pos\\,0)", [drawn, frame, frame]],
    ["select=gt(n\\,0),setpts=PTS-STARTPTS,", "eq(pos\\,16)", [drawn, frame]]
  ] as const) {
    it(`drawbox uses packet offsets for ${prefix}${expression} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.concat([frame, frame, frame]) });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `${prefix}drawbox=x=1:y=1:w=1:h=1:t=fill:c=white:enable=${expression}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "4x4",
          "-framerate", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(Buffer.concat(output), Buffer.concat(expected));
    });
  }

  for (const expression of ["isnan(pos)", "pos"]) {
    it(`drawbox exposes unknown packet offsets as NaN for ${expression} (${graph ? "graph" : "simple"})`, async () => {
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `format=rgba,drawbox=x=1:y=1:w=1:h=1:t=fill:c=white:enable=${expression}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "lavfi", "-i", "color=black:s=4x4:d=1:r=1",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal, fs: {},
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const expected = Buffer.from(Array.from({ length: 16 }, () => [0, 0, 0, 255]).flat());
      if (expression === "isnan(pos)") expected.fill(255, 20, 23);
      assert.deepEqual(Buffer.concat(output), expected);
    });
  }
}
