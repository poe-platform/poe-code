import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Frame IDs verified against FFmpeg 7.0.2 with a disabled framestep filter.
for (const complex of [false, true]) {
  for (const filter of ["framestep=3:enable=0", "null"]) {
    for (const [mode, ids] of [
      ["auto", [1, 2, 3, 6]],
      ["cfr", [1, 2, 3, 6]],
      ["vfr", [1, 2, 5, 8]],
      ["passthrough", [1, 2, 3, 4, 5, 6, 7, 8]]
    ] as const) {
      it(`synchronizes ${filter} raw output in ${mode} mode (${complex ? "mapped" : "simple"})`, async () => {
        const source = Buffer.from(Array.from({ length: filter === "null" ? 16 : 32 }, (_, index) => Math.floor(index / 4) + 1));
        const volume = Volume.fromJSON({ "/in.raw": source });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-framerate", "4", "-pixel_format", "gray",
            "-video_size", "2x2", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"]
              : filter === "null" ? [] : ["-vf", filter]),
            ...(mode === "auto" ? [] : ["-fps_mode", mode]), "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from((filter === "null" ? [1, 2, 3, 4] : ids).flatMap(id => [id, id, id, id])));
        assert.deepEqual(volume.readFileSync("/in.raw"), source);
      });
    }
}
}
