import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2: scheduling options preserve all four 2x2 gray frames.
for (const [options, exitCode] of [
  ["", 0],
  ["=threads=1", 0],
  ["=thread_type=slice", 0],
  ["=extra_hw_frames=1", 0],
  ["=threads=1:thread_type=slice:extra_hw_frames=1", 0],
  ["=threads=0:thread_type=0:extra_hw_frames=-1", 0],
  ["=threads=1+1:thread_type=+slice:extra_hw_frames=all", 0],
  ["=threads=-1", 222],
  ["=threads=2147483648", 222],
  ["=threads=", 234],
  ["=threads=bad:threads=1", 234],
  ["=thread_type=bad", 234],
  ["=thread_type=0.5", 222],
  ["=extra_hw_frames=-2", 222],
  ["=extra_hw_frames=2147483648", 222],
  ["=unknown=1", 8]
] as const) {
  for (const complex of [false, true]) {
    for (const output of ["pipe:1", "/out.raw"]) {
      it(`tmix scheduling ${options || "defaults"} (${complex ? "graph" : "simple"}, ${output})`, async () => {
        const input = Buffer.from("1160affe4d9ceb3a89d82776c51463b2", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const before = volume.toJSON();
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const filter = `tmix${options}`;
        const argumentValues = createCommandArguments([
          "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "2x2", "-framerate", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
          "-pix_fmt", "gray", "-f", "rawvideo", output
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
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        const stdout = Buffer.concat(chunks);
        if (exitCode === 0) {
          assert.equal(stderr, "");
          assert.deepEqual(output === "pipe:1" ? stdout : volume.readFileSync(output),
            Buffer.from("1160affe2574c3bd4d9c968f89837c76", "hex"));
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
          if (output === "pipe:1") assert.deepEqual(volume.toJSON(), before);
          else assert.equal(stdout.length, 0);
        } else {
          assert.ok(stderr.includes("tmix:"), stderr);
          assert.equal(stdout.length, 0);
          assert.deepEqual(volume.toJSON(), before);
        }
      });
    }
  }
}
