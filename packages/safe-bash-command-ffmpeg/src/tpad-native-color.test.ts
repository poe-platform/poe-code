import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 solid samples; source frames are checked separately.
for (const [format, color, sample] of [
  ["gray16be", "white", "ffff"],
  ["gray16le", "white", "ffff"],
  ["gray16be", "red", "4c8b"],
  ["gray16le", "red", "8b4c"],
  ["rgb48be", "red", "ffff00000000"],
  ["rgb48le", "red", "ffff00000000"],
  ["rgba64be", "#123456@0.25", "1212343456563f3f"],
  ["rgba64le", "#123456@0.25", "1212343456563f3f"],
  ["gray", "red", "4c"]
] as const) {
  for (const graph of [false, true]) {
    for (const mode of ["start", "stop", "clone", "bounded"]) {
      it(`preserves ${format} ${color} tpad ${mode} samples (${graph ? "graph" : "simple"})`, async () => {
        const solid = Buffer.from(sample.repeat(2), "hex");
        const frameBytes = solid.length;
        const input = Buffer.from(Array.from({ length: frameBytes * 3 }, (_, i) => (i * 37 + 11) % 256));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const filter = mode === "clone" ? "tpad=start=1:stop=1:start_mode=clone:stop_mode=clone"
          : `tpad=${mode === "bounded" ? "stop=-1" : `${mode}=1`}:color=${color}${mode === "bounded" ? ",trim=end_frame=5" : ""}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x1",
            "-framerate", "4", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
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
        const bytes = Buffer.concat(output);
        const sourceOffset = mode === "start" || mode === "clone" ? frameBytes : 0;
        assert.deepEqual(bytes.subarray(sourceOffset, sourceOffset + input.length), input, "source frames");
        assert.deepEqual(volume.readFileSync("/in.raw"), input, "input file");
        assert.equal(bytes.length, frameBytes * (mode === "clone" || mode === "bounded" ? 5 : 4));
        if (mode === "clone") {
          assert.deepEqual(bytes.subarray(0, frameBytes), input.subarray(0, frameBytes), "start clone");
          assert.deepEqual(bytes.subarray(-frameBytes), input.subarray(-frameBytes), "stop clone");
        } else {
          const generated = mode === "start" ? bytes.subarray(0, frameBytes) : bytes.subarray(input.length);
          assert.deepEqual(generated, mode === "bounded" ? Buffer.concat([solid, solid]) : solid, "solid frames");
        }
      });
    }
  }
}
