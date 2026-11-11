import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7 uses the next frame PTS, or the upstream EOF, for the second field.
for (const { count, filter, pts, pixels } of [
  { count: 1, filter: "select='eq(n,0)'", pts: [0, 1], pixels: "1b220d14" },
  { count: 2, filter: "select='eq(n,0)'", pts: [0, 2], pixels: "1b220d14" },
  { count: 2, filter: "select='eq(n,0)',setpts=2*PTS+3", pts: [6, 10], pixels: "1b220d14" },
  { count: 2, filter: "setpts=2*PTS+3,select='eq(n,0)'", pts: [6, 10], pixels: "1b220d14" },
  { count: 2, filter: "null", pts: [0, 1, 2, 3], pixels: "1b220d14373e2930" },
  { count: 3, filter: "select='not(eq(n,1))'", pts: [0, 2, 4, 5], pixels: "1b220d14535a454c" },
  { count: 2, filter: "select=0", pts: [], pixels: "" }
]) {
  for (const graph of [false, true]) {
    it(`separatefields uses upstream timing after ${filter} (${count} frames, ${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from(Array.from({ length: count * 4 }, (_, i) => 13 + 7 * i));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const chain = `${filter},separatefields,showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "2x2", "-r", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${chain}[v]`, "-map", "[v]"] : ["-vf", chain]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), pixels);
      const info = stderr.split("\n").filter(line => line.includes(" pts:"));
      assert.deepEqual(info.map(line => Number(line.split(" ").find(token => token.startsWith("pts:"))?.slice(4))), pts, stderr);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
