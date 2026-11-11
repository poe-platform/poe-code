import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} PJS removes exact duplicates before numbering SRT cues`, async () => {
      const volume = Volume.fromJSON({
        "/input.pjs": '10,20,"Alpha"\n10,20,"Alpha"\n10,21,"Alpha"\n10,20,"Other"\n11,20,"Alpha"\n30,40,"Beta"\n10,20,"Alpha"\n'
      });
      const args = ["-v", "error", ...(forced ? ["-f", "pjs"] : []), "-i", "/input.pjs", "-f", "srt", sync ? "/out.srt" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out.srt", "utf8") as string;
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
      assert.equal(stdout,
        "1\n00:00:01,000 --> 00:00:02,000\nAlpha\n\n" +
        "2\n00:00:01,000 --> 00:00:02,100\nAlpha\n\n" +
        "3\n00:00:01,000 --> 00:00:02,000\nOther\n\n" +
        "4\n00:00:01,100 --> 00:00:02,000\nAlpha\n\n" +
        "5\n00:00:03,000 --> 00:00:04,000\nBeta\n\n");
    });
  }
}
