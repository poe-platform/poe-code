import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [rate, expected] of [
  ["3", "1\n00:00:00,042 --> 00:00:00,042\n3\n\n2\n00:00:01,043 --> 00:00:02,086\nFirst\n\n3\n00:00:03,128 --> 00:00:04,171\nLast\n\n"],
  ["100", "1\n00:00:00,042 --> 00:00:00,042\n100\n\n2\n00:00:01,043 --> 00:00:02,086\nFirst\n\n3\n00:00:03,128 --> 00:00:04,171\nLast\n\n"],
  ["4", "1\n00:00:06,250 --> 00:00:12,500\nFirst\n\n2\n00:00:18,750 --> 00:00:25,000\nLast\n\n"],
  ["60", "1\n00:00:00,417 --> 00:00:00,834\nFirst\n\n2\n00:00:01,250 --> 00:00:01,667\nLast\n\n"]
]) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} matches native MicroDVD frame-rate detection for ${rate}`, async () => {
      const input = `{1}{1}${rate}\n{25}{50}First\n{75}{100}Last\n`;
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
