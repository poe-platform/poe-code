import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg keeps the 2x2 crop and exits successfully after rejecting these commands.
for (const [action, value, width, height] of [
  ["w", "5", 5, 2], ["out_w", "999", 999, 2],
  ["h", "5", 2, 5], ["out_h", "-1", 2, -1]
] as const) {
  for (const level of ["error", "warning", "16", "fatal", "quiet"]) {
    for (const graph of [false, true]) {
      it(`reports rejected crop ${action}=${value} at ${level} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.from(Array.from({ length: 16 }, (_, i) => 13 + 7 * i));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `sendcmd='0 crop ${action} ${value}',crop=2:2:0:0`;
        const output: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", level, "-f", "rawvideo", "-pix_fmt", "gray", "-s", "4x4", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(Buffer.concat(output).toString("hex"), "0d142930");
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        if (level === "fatal" || level === "quiet") {
          assert.equal(stderr, "");
        } else {
          assert.ok(stderr.includes(`Invalid too big or non positive size for width '${width}' or height '${height}'`), stderr);
        }
      });
    }
  }
}
