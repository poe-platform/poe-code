import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete raw output and metadata from native FFmpeg 7.0.2.
const input = "202020208080404040408080606060608080808080808080";
for (const [filter, pixels, values, selected] of [
  ["weave", "202040402020404080808080606080806060808080808080", ["64", "128"], "202040402020404080808080"],
  ["doubleweave", "202040402020404080808080606040406060404080808080606080806060808080808080", ["64", "96", "128"], "202040402020404080808080"],
  ["null", input, ["32", "64", "96", "128"], "404040408080"]
] as const) {
  for (const mode of ["print", "select"]) {
    it(`${filter} preserves native second-field metadata for ${mode}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", mode === "print" ? "info" : "error",
          "-f", "rawvideo", "-pixel_format", "yuv420p", "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
          "-vf", `signalstats,${filter},metadata=${mode}:key=lavfi.signalstats.YAVG${mode === "select" ? ":value=64" : ""}`,
          "-fps_mode", "passthrough", "-pix_fmt", "yuv420p", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), mode === "print" ? pixels : selected);
      if (mode === "print") {
        assert.deepEqual(stderr.split("\n").filter(line => line.includes("lavfi.signalstats.YAVG="))
          .map(line => line.split("lavfi.signalstats.YAVG=")[1]), values);
      } else {
        assert.equal(stderr, "");
      }
    });
  }
}
