import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Expected output matches native FFmpeg.
for (const [name, input, expected] of [
  ["second", "{0}{10}Intro\n{1}{1}25\n{25}{50}First\n{75}{100}Last\n", "1\n00:00:00,000 --> 00:00:00,400\nIntro\n\n2\n00:00:01,000 --> 00:00:02,000\nFirst\n\n3\n00:00:03,000 --> 00:00:04,000\nLast\n\n"],
  ["third", "{0}{10}Intro\n{10}{20}Next\n{1}{1}25\n{25}{50}First\n{75}{100}Last\n", "1\n00:00:00,000 --> 00:00:00,400\nIntro\n\n2\n00:00:00,400 --> 00:00:00,800\nNext\n\n3\n00:00:01,000 --> 00:00:02,000\nFirst\n\n4\n00:00:03,000 --> 00:00:04,000\nLast\n\n"],
  ["fourth", "{0}{2}Intro0\n{2}{4}Intro1\n{4}{6}Intro2\n{1}{1}25\n{25}{50}First\n{75}{100}Last\n", "1\n00:00:00,000 --> 00:00:00,083\nIntro0\n\n2\n00:00:00,042 --> 00:00:00,042\n25\n\n3\n00:00:00,083 --> 00:00:00,166\nIntro1\n\n4\n00:00:00,167 --> 00:00:00,250\nIntro2\n\n5\n00:00:01,043 --> 00:00:02,086\nFirst\n\n6\n00:00:03,128 --> 00:00:04,171\nLast\n\n"]
] as const) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} matches native SRT with a ${name}-record rate declaration`, async () => {
      const volume = Volume.fromJSON({ "/input.sub": input });
      const args = ["-v", "error", "-f", "microdvd", "-i", "/input.sub",
        "-f", "srt", sync ? "/output" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/output", "utf8").toString();
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
      assert.equal(stdout, expected);
    });
  }
}
