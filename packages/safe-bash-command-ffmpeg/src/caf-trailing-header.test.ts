import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Original native regression fixture: eight PCM16 samples followed by "abc".
const trailing = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c616263", "hex");
const intact = trailing.subarray(0, -3);

for (const [name, input, valid, probeDuration] of [
  ["incomplete header after data", trailing, true, 10],
  ["incomplete header before data", Buffer.concat([trailing.subarray(0, 52), Buffer.from("abc")]), false, 0],
  ["complete free chunk after data", Buffer.concat([intact, Buffer.from("667265650000000000000003616263", "hex")]), true, 16]
] as const) {
  for (const command of ["sync ffmpeg", "ffmpeg", "ffprobe"] as const) {
    it(`${command} validates CAF ${name} before writing output`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.caf", input);
      const args = command === "ffprobe"
        ? ["-v", "error", "-show_streams", "-of", "json", "/in.caf"]
        : ["-v", "error", "-y", "-i", "/in.caf", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
      if (command === "sync ffmpeg") {
        const run = () => evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(run(), valid ? "" : undefined);
      } else {
        let stdout = "", stderr = "";
        const result = await (command === "ffmpeg" ? createFfmpegCommand() : createFfprobeCommand()).execute({
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
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          if (command === "ffprobe") {
            const stream = JSON.parse(stdout).streams[0];
            assert.equal(stream.codec_name, "pcm_s16be");
            // Native ffprobe estimates duration through EOF for seekable CAF without a packet table.
            assert.equal(stream.duration_ts, probeDuration);
          }
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.match(stderr, /Truncated CAF chunk header/);
        }
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), valid && command !== "ffprobe"
        ? Buffer.from("650066006700680069006a006b006c00", "hex") : Buffer.from("KEEP"));
    });
  }
}
