import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfprobeCommand } from "safe-bash-command-ffprobe";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Signed big-endian LPCM samples [100, -200, 300, -400].
// Native FFmpeg accepts the explicit signed-integer flag (4).
const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d000000040000000200000001000000010000001064617461000000000000000c000000000064ff38012cfe70", "hex");

for (const mode of ["decode", "copy", "probe"] as const) {
  for (const sync of mode === "probe" ? [false] : [false, true]) {
    it(`accepts signed-integer CAF for ${mode} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.caf", input);
      const args = mode === "probe"
        ? ["-v", "error", "-show_packets", "-show_entries", "packet=pos,size,duration:stream=codec_name,sample_rate,channels,duration_ts", "-of", "json", "/in.caf"]
        : ["-v", "error", "-y", "-i", "/in.caf", "-c:a", mode === "copy" ? "copy" : "pcm_s16le", "-f", mode === "copy" ? "s16be" : "s16le", "/out.raw"];
      let stdout = "", stderr = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        const result = await (mode === "probe" ? createFfprobeCommand() : createFfmpegCommand()).execute({
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
        assert.equal(result.exitCode, 0, stderr);
      }
      if (mode === "probe") {
        const result = JSON.parse(stdout);
        assert.deepEqual(result.packets, [{ duration: 4, size: "8", pos: "68" }]);
        assert.deepEqual(result.streams, [{ codec_name: "pcm_s16be", sample_rate: "8000", channels: 1, duration_ts: 4 }]);
      } else {
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(mode === "copy" ? "0064ff38012cfe70" : "640038ff2c0170fe", "hex"));
      }
    });
  }
}
