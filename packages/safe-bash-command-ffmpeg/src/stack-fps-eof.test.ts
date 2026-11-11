import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reports stack EOF at the last synchronized frame's PTS.
for (const stack of ["hstack", "vstack", "xstack=layout=0_0|w0_0"]) {
  for (const shortest of [false, true]) {
    for (const downstream of ["", ",fps=4", "[stack];[stack]fps=4"]) {
      it(`${stack} preserves EOF with shortest=${shortest} through ${downstream || "passthrough"}`, async () => {
        const volume = Volume.fromJSON({
          "/a.gray": Buffer.concat([16, 32, 48, 64].map(value => Buffer.alloc(4, value))),
          "/b.gray": Buffer.concat([96, 112].map(value => Buffer.alloc(4, value)))
        });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const filter = stack + (shortest ? `${stack.includes("=") ? ":" : "="}shortest=1` : "");
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error",
            "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2", "-framerate", "4", "-i", "/a.gray",
            "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2", "-framerate", "4", "-i", "/b.gray",
            "-filter_complex", `[0:v][1:v]${filter}${downstream}[out]`, "-map", "[out]",
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const count = (shortest ? 2 : 4) - (downstream ? 1 : 0);
        const expected = [16, 32, 48, 64].slice(0, count).flatMap((left, index) => {
          const right = index === 0 ? 96 : 112;
          return stack === "vstack"
            ? [left, left, left, left, right, right, right, right]
            : [left, left, right, right, left, left, right, right];
        });
        assert.deepEqual(Buffer.concat(stdout), Buffer.from(expected));
      });
    }
  }
}
