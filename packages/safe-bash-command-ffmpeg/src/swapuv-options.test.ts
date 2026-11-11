import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: option-not-found returns 8 on Linux without video output.
for (const [filter, exitCode, option] of [
  ["swapuv=unknown=1", 8, "unknown"],
  ["swapuv@chroma=missing=1", 8, "missing"],
  ["swapuv", 0, undefined]
] as const) {
  for (const destination of ["pipe:1", "/out.raw"]) {
    it(`${filter} returns ${exitCode} with ${destination}`, async () => {
      const input = Buffer.from("2f3a45505b66717c87929da8b3bec9d4df18232e39444f5a", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "yuv420p",
          "-video_size", "4x2", "-i", "/in.raw", "-vf", filter,
          "-pix_fmt", "yuv420p", "-f", "rawvideo", destination],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += Buffer.from(bytes).toString(); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      const output = Buffer.concat(stdout);
      if (option) {
        assert.ok(stderr.includes("swapuv") && stderr.includes(option), stderr);
        assert.equal(output.length, 0);
        assert.equal(volume.readFileSync("/out.raw").toString(), "KEEP");
      } else {
        assert.equal(stderr, "");
        assert.equal((destination === "pipe:1" ? output : volume.readFileSync(destination)).toString("hex"),
          "2f3a45505b66717c9da88792b3bec9d4df18232e4f5a3944");
      }
    });
  }
}
