import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Exact native FFmpeg 7.0.2 output, including the empty second cue.
for (const sync of [false, true]) {
  for (const explicit of [false, true]) {
    it(`${sync ? "sync" : "async"} preserves empty LRC cues (${explicit ? "explicit" : "detected"})`, async () => {
      const volume = Volume.fromJSON({ "/in.empty.lrc": "[00:01.20]First\n[00:02.00]\n[00:03.00]Two\n" });
      const args = ["-v", "error", ...(explicit ? ["-f", "lrc"] : []), "-i", "/in.empty.lrc",
        "-fflags", "+bitexact", "-f", "srt", sync ? "/out.srt" : "pipe:1"];
      let output = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        output = volume.readFileSync("/out.srt", "utf8").toString();
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(output,
        "1\n00:00:01,200 --> 00:00:02,000\nFirst\n\n2\n00:00:02,000 --> 00:00:03,000\n\n\n3\n00:00:03,000 --> 1193:02:50,295\nTwo\n\n");
    });
  }
}
