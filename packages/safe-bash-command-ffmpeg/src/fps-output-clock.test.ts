import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: four gray frames at 4 fps become source frames 1, 2, 4 at 3 fps.
for (const graph of [false, true]) {
  for (const fps of [undefined, 2, 3]) {
    for (const format of ["framecrc", "framemd5", "framehash", "rawvideo"]) {
      it(`${format} preserves the fps=${fps ?? "input"} output clock (graph=${graph})`, async () => {
        const input = Buffer.from([1, 2, 3, 4].flatMap(id => Array(4).fill(id)));
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stdout = "";
        let stderr = "";
        const filter = fps === undefined ? [] : graph
          ? ["-filter_complex", `[0:v]fps=${fps}[out]`, "-map", "[out]"] : ["-vf", `fps=${fps}`];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-progress", "pipe:1", "-f", "rawvideo",
            "-framerate", "4", "-pixel_format", "gray", "-video_size", "2x2", "-i", "/in.raw",
            ...filter, "-f", format, "/out.bin"],
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
        const ids = fps === 3 ? [1, 2, 4] : fps === 2 ? [1, 3] : [1, 2, 3, 4];
        if (format === "rawvideo") {
          assert.deepEqual(volume.readFileSync("/out.bin"), Buffer.from(ids.flatMap(id => Array(4).fill(id))));
        } else {
          const output = volume.readFileSync("/out.bin", "utf8") as string;
          assert.ok(output.includes(`#tb 0: 1/${fps ?? 4}\n`), output);
          const packets = output.split("\n").filter(line => line.startsWith("0,"))
            .map(line => line.split(",").map(field => field.trim()));
          assert.deepEqual(packets.map(fields => fields.slice(0, 5)),
            ids.map((_, index) => ["0", String(index), String(index), "1", "4"]));
          if (format === "framecrc") {
            assert.deepEqual(packets.map(fields => fields[5]), ids.map(id => `0x${(10 * id).toString(16).padStart(4, "0")}${(4 * id).toString(16).padStart(4, "0")}`));
          }
        }
        const progress = Object.fromEntries(stdout.trim().split("\n").map(line => line.split("=")));
        assert.equal(progress.frame, String(ids.length));
        assert.equal(progress.out_time_us, "1000000");
        assert.equal(progress.progress, "end");
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
