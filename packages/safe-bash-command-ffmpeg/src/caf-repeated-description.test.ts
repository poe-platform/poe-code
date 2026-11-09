import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Exact native-accepted CAF fixture: eight samples, 8 kHz desc followed by 16 kHz desc.
const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001064657363000000000000002040cf4000000000006c70636d00000000000000020000000100000001000000106461746100000000000000140000000000650066006700680069006a006b006c", "hex");

for (const repeatedRate of [16000, 8000]) {
  for (const command of ["sync ffmpeg", "ffmpeg", "ffprobe"] as const) {
    it(`${command} retains the first CAF description before a ${repeatedRate} Hz duplicate`, async () => {
      const bytes = Buffer.from(input);
      bytes.writeDoubleBE(repeatedRate, 64);
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.caf", bytes);
      const args = command === "ffprobe"
        ? ["-v", "error", "-show_entries", "packet=pts,duration,size:stream=sample_rate,channels,duration_ts,nb_frames", "-of", "json", "/in.caf"]
        : ["-v", "error", "-y", "-i", "/in.caf", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
      if (command === "sync ffmpeg") {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, output) => { volume.writeFileSync(path, output); return true; }), "");
      } else {
        let stdout = "", stderr = "";
        const result = await (command === "ffmpeg" ? createFfmpegCommand() : createFfprobeCommand()).execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, output: Uint8Array) { volume.writeFileSync(path, output); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(output: Uint8Array) { stdout += new TextDecoder().decode(output); } },
          stderr: { async write(output: Uint8Array) { stderr += new TextDecoder().decode(output); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        if (command === "ffprobe") {
          const probe = JSON.parse(stdout);
          assert.deepEqual(probe.packets, [{ pts: 0, duration: 8, size: "16" }]);
          assert.deepEqual(probe.streams, [{ sample_rate: "8000", channels: 1, duration_ts: 8, nb_frames: "8" }]);
        }
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), command === "ffprobe"
        ? Buffer.from("KEEP") : Buffer.from("650066006700680069006a006b006c00", "hex"));
    });
  }
}
