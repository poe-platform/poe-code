import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [options, expected, maxSamples] of [
    [["-frames:v", "6"], "0a0b1e1f3c3d3c3d3c3d3c3d", 6],
    [["-t", "1.5"], "0a0b1e1f3c3d3c3d3c3d3c3d", 7],
    [["-frames:v", "0"], "", 6],
    [["-t", "0"], "", 6],
    [["-ss", "0.75", "-frames:v", "3"], "3c3d3c3d3c3d", 6],
    [["-ss", "0.75", "-t", "0.75"], "3c3d3c3d3c3d", 7],
    [[], null, 10],
    [["-frames:v", "6"], null, 5]
  ] as const) {
    it(`bounds ${graph ? "graph" : "simple"} gray tpad output with ${options.join(" ")} and ${maxSamples} samples`, async () => {
      const input = Buffer.from("0a0b1e1f3c3d", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const filter = "tpad=stop=-1:stop_mode=clone";
      const result = await createFfmpegCommand({ limits: { maxSamplesPerTrack: maxSamples } }).execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x1",
          "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          ...options, "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes(options.length ? "maxSamplesPerTrack" : "finite output"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
