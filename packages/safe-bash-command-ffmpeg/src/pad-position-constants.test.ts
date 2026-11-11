import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from([13, 20, 27, 34]);
// Native FFmpeg 7.0.2 truncates coordinates and centers positions outside the canvas.
for (const [options, expected] of [
  ["4:2:PI:0", "000d1400001b2200"],
  ["4:2:E:0", "00000d1400001b22"],
  ["4:2:PHI:0", "000d1400001b2200"],
  ["2:4:0:PI", "00000d141b220000"],
  ["2:4:0:E", "000000000d141b22"],
  ["2:4:0:PHI", "00000d141b220000"],
  ["w=4:h=2:x=PI+E-PHI-2:y=0", "00000d1400001b22"]
] as const) {
  for (const graph of [false, true]) {
    it(`evaluates pad=${options} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `pad=${options}`;
      const argumentValues = createCommandArguments([
        "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
        "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"
      ]);
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.deepEqual(Buffer.concat(output), Buffer.from(expected, "hex"));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
