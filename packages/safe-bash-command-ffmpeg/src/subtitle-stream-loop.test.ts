import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 writes the first subtitle pass, then its restart seek fails
// with AVERROR(ERANGE), including infinite loops and stream copy.
for (const format of ["srt", "webvtt", "srt-copy"]) {
  for (const loop of [0, 1, 3, -1]) {
    for (const target of ["pipe:1", "/out.srt"]) {
      it(`${format} loop ${loop} preserves the first pass to ${target}`, async () => {
        const expected = "1\n00:00:00,000 --> 00:00:01,000\nA\n\n";
        const volume = Volume.fromJSON({
          "/in.srt": format === "webvtt" ? "WEBVTT\n\n00:00.000 --> 00:01.000\nA\n" : expected.trimEnd() + "\n",
          "/out.srt": "KEEP"
        });
        const args = ["-v", "error", "-y", "-stream_loop", String(loop),
          ...(format === "webvtt" ? ["-f", "webvtt"] : []), "-i", "/in.srt",
          ...(format === "srt-copy" ? ["-c:s", "copy"] : []), "-f", "srt", target];
        let writes = 0;
        const sync = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { writes++; volume.writeFileSync(path, bytes); return true; });
        if (loop !== 0) {
          assert.equal(sync, undefined);
          assert.equal(writes, 0);
          assert.equal(volume.readFileSync("/out.srt", "utf8"), "KEEP");
        } else {
          assert.equal(sync, target === "pipe:1" ? undefined : "");
        }
        let stdout = "";
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(target === "pipe:1" ? stdout : volume.readFileSync(target, "utf8"), expected);
        assert.equal(result.exitCode, loop === 0 ? 0 : 222, stderr);
        if (loop === 0) assert.equal(stderr, "");
        else assert.ok(stderr.includes("Numerical result out of range"), stderr);
      });
    }
  }
}
