import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 treats audio-only variables as NaN in video select.
for (const complex of [false, true]) {
  for (const [expression, keep] of [
    ["isnan(samples_n)", true],
    ["isnan(consumed_samples_n)", true],
    ["isnan(sample_rate)", true],
    ["not(isnan(samples_n))", false],
    ["not(isnan(consumed_samples_n))", false],
    ["not(isnan(sample_rate))", false],
    ["1", true]
  ] as const) {
    it(`video select=${expression} (${complex ? "complex" : "simple"}) preserves timestamps and payloads`, async () => {
      const input = Buffer.from(Array.from({ length: 60 }, (_, i) => i));
      const volume = Volume.fromJSON({ "/in.rgb": input });
      for (const format of ["framecrc", "rawvideo"]) {
        const output: Uint8Array[] = [];
        let stderr = "";
        const filter = `select=${expression}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2",
            "-framerate", "5", "-i", "/in.rgb",
            ...(complex ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", format, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const bytes = Buffer.concat(output);
        if (format === "framecrc") {
          const rows = bytes.toString().split("\n").filter(line => line && !line.startsWith("#"));
          assert.deepEqual(rows.map(row => Number(row.split(",")[2])), keep ? [0, 1, 2, 3, 4] : []);
        } else {
          assert.deepEqual(bytes, keep ? input : Buffer.alloc(0));
        }
      }
      assert.deepEqual(volume.readFileSync("/in.rgb"), input);
    });
  }
}
