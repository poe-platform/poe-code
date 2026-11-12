import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 rejects an unknown select variable with EINVAL (234).
for (const [expression, exitCode] of [["no_such_variable", 234], ["1", 0]] as const) {
  for (const graph of [false, true]) {
    for (const format of ["framecrc", "rawvideo"]) {
      it(`select=${expression} exits ${exitCode} with ${format} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.from(Array.from({ length: 60 }, (_, index) => index));
        const volume = Volume.fromJSON({ "/in.rgb": input });
        const before = volume.toJSON();
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
            "-video_size", "2x2", "-framerate", "5", "-i", "/in.rgb",
            ...(graph ? ["-filter_complex", `[0:v]select=${expression}[v]`, "-map", "[v]"]
              : ["-vf", `select=${expression}`]),
            "-fps_mode", "passthrough", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", format, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.deepEqual(volume.toJSON(), before);
        const output = Buffer.concat(chunks);
        if (exitCode !== 0) {
          assert.ok(stderr.includes("select:"), stderr);
          assert.equal(output.length, 0);
        } else if (format === "rawvideo") {
          assert.deepEqual(output, input);
        } else {
          const text = output.toString();
          assert.ok(text.includes("#tb 0: 1/5"), text);
          const rows = text.split("\n").filter(line => line && !line.startsWith("#"))
            .map(line => line.split(",").map(value => value.trim()));
          assert.deepEqual(rows, [
            ["0", "0", "0", "1", "12", "0x011e0042"],
            ["0", "1", "1", "1", "12", "0x04c600d2"],
            ["0", "2", "2", "1", "12", "0x086e0162"],
            ["0", "3", "3", "1", "12", "0x0c1601f2"],
            ["0", "4", "4", "1", "12", "0x0fbe0282"]
          ]);
        }
      });
    }
  }
}
