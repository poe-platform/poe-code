import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2 distinguishes unknown keys, positional values and timelines.
for (const [suffix, status] of [["=x=1", 8], ["=1", 234], ["=enable=1", 176], ["", 0]] as const) {
  for (const destination of ["pipe:1", "/out.raw"]) {
    for (const graph of [false, true]) {
      it(`separatefields${suffix} returns ${status} for ${destination} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.from("0d141b22", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const filter = `separatefields${suffix},showinfo`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-y", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-r", "2", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", destination],
          command: "ffmpeg", cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, status, stderr);
        const fields = Buffer.from("1b220d14", "hex");
        assert.deepEqual(Buffer.concat(stdout), status === 0 && destination === "pipe:1" ? fields : Buffer.alloc(0));
        assert.deepEqual(volume.readFileSync("/out.raw"), status === 0 && destination === "/out.raw" ? fields : Buffer.from("KEEP"));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        if (status !== 0) {
          assert.ok(stderr.includes("separatefields"), stderr);
          assert.ok(!stderr.includes("pts_time:"), stderr);
        }
      });
    }
  }
}
