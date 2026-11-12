import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete packet expectations from native FFmpeg 7.0.2.
for (const filter of ["framestep=2", "tile=2x2"]) {
  for (const prefix of ["", "setpts=PTS,", "setpts=PTS+1,"]) {
    it(`preserves the encoder clock for ${prefix}${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from([1, 2, 3, 4, 5, 6, 7]) });
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw", "-vf", prefix + filter,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "framecrc", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0);
      assert.equal(Buffer.concat(stderr).toString(), "");
      const lines = Buffer.concat(stdout).toString().trimEnd().split("\n");
      const tiled = filter === "tile=2x2";
      assert.equal(lines.find(line => line.startsWith("#tb ")), `#tb 0: 1/${prefix ? 4 : tiled ? 1 : 2}`);
      const checksums = tiled ? ["0x0014000a", "0x00340012"]
        : ["0x00010001", "0x00030003", "0x00050005", "0x00070007"];
      assert.deepEqual(lines.filter(line => !line.startsWith("#"))
        .map(line => line.split(",").map(value => value.trim())), checksums.map((checksum, index) => {
        const pts = String(index * (prefix ? tiled ? 4 : 2 : 1) + (prefix === "setpts=PTS+1," ? 1 : 0));
        return ["0", pts, pts, "1", tiled ? "4" : "1", checksum];
      }));
    });
  }
}
