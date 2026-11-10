import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 48 }, (_, i) => [16 + i, 32 + i, 64 + i, 128 + i]).flat());
for (const complex of [false, true]) {
  for (const [expression, rounded] of [["PI/3", 1], ["E", 3], ["PHI", 2], ["1", 1], ["2", 2], ["pi", -1], ["e", -1], ["phi", -1], ["PI_unknown", -1]] as const) {
    for (const field of [0, 1, 2, 3]) {
      it(`crop evaluates ${expression} in field ${field} (${complex ? "graph" : "simple"})`, async () => {
        const values = ["2", "2", "0", "0"];
        values[field] = expression;
        const filter = `crop=${values.join(":")}`;
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (rounded < 0) {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("crop: invalid or unsupported expression"), stderr);
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        } else {
          assert.equal(result.exitCode, 0, stderr);
          const [width, height, x, y] = [2, 2, 0, 0].map((value, index) => index === field ? (field < 2 ? rounded : Math.min(2, rounded)) : value);
          const rows: Buffer[] = [];
          for (let frame = 0; frame < 3; frame++) for (let row = 0; row < height!; row++) {
            const start = (frame * 16 + (y! + row) * 4 + x!) * 4;
            rows.push(input.subarray(start, start + width! * 4));
          }
          assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(rows));
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
