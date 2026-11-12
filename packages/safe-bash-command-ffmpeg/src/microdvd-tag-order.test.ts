import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Complete SRT output from native FFmpeg 7.0.2, including tied timestamps.
const cues = [
  ['{y:ib}{c:$112233}Hi', '<font color="#332211"><i><b>Hi</b></i></font>'],
  ['{c:$112233}{y:ib}Hi', '<font color="#332211"><i><b>Hi</b></i></font>'],
  ["{y:i}Hi", "<i>Hi</i>"]
];

for (const sync of [false, true]) {
  for (const [cue, expected] of cues) {
    it(`${sync ? "sync" : "async"} MicroDVD nests font outside emphasis: ${cue}`, async () => {
      const input = `{25}{50}${cue}\n{25}{50}First\n{75}{100}Last\n`;
      const volume = Volume.fromJSON({ "/in.sub": input });
      const args = ["-v", "error", "-f", "microdvd", "-i", "/in.sub", "-f", "srt",
        sync ? "/out.srt" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out.srt", "utf8").toString();
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(stdout, `1\n00:00:01,043 --> 00:00:02,086\n${expected}\n\n`
        + "2\n00:00:01,043 --> 00:00:02,086\nFirst\n\n"
        + "3\n00:00:03,128 --> 00:00:04,171\nLast\n\n");
      assert.equal(volume.readFileSync("/in.sub", "utf8"), input);
    });
  }
}
