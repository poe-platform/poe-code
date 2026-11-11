import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg baseline: output -r uses CFR tolerance; fps filters select frames.
for (const [options, indices, seconds] of [
  [[], [0, 1, 2, 3], 1],
  [["-r", "2"], [0, 1, 2, 3], 2],
  [["-r", "8"], [0, 0, 1, 1, 2, 2, 3, 3], 1],
  [["-vf", "fps=2"], [0, 2], 1],
  [["-vf", "fps=2", "-r", "2"], [0, 2], 1]
] as const) {
  for (const progress of [false, true]) {
    it(`rawvideo preserves native frames for ${options.join(" ") || "input rate"}, progress=${progress}`, async () => {
      const input = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", ...(progress ? ["-progress", "pipe:1"] : []),
          "-f", "rawvideo", "-framerate", "4", "-pixel_format", "gray", "-video_size", "2x2",
          "-i", "/in.raw", ...options, "-f", "rawvideo", "/out.bin"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(volume.readFileSync("/out.bin"), Buffer.concat(indices.map(index => input.subarray(index * 4, index * 4 + 4))));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      if (progress) {
        const record = Object.fromEntries(stdout.trim().split("\n").map(line => line.split("=")));
        assert.equal(record.progress, "end");
        assert.equal(record.frame, String(indices.length));
        assert.equal(record.out_time, `00:00:0${seconds}.000000`);
      } else assert.equal(stdout, "");
    });
  }
}
