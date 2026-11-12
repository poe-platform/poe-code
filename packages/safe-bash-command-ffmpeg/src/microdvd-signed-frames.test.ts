import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Exact stdout from native FFmpeg 7.0.2 at the default 24000/1001 frame rate.
const cases = [
  {
    input: "{-25}{0}Before\n{25}{50}First\n{75}{100}Last\n",
    output: "1\n00:00:00,000 --> 00:00:01,043\nBefore\n\n2\n00:00:02,086 --> 00:00:03,129\nFirst\n\n3\n00:00:04,171 --> 00:00:05,214\nLast\n\n"
  },
  ...["{+1}{25}Before", "{ 1}{25}First", "{1}{ 25}First", "{1}{25}Before"].map(first => ({
    input: `${first}\n{25}{50}First\n{75}{100}Last\n`,
    output: `1\n00:00:00,042 --> 00:00:01,043\n${first.slice(first.lastIndexOf("}") + 1)}\n\n2\n00:00:01,043 --> 00:00:02,086\nFirst\n\n3\n00:00:03,128 --> 00:00:04,171\nLast\n\n`
  }))
];

for (const { input, output } of cases) {
  for (const explicit of [false, true]) {
    for (const sync of [false, true]) {
      it(`${sync ? "sync" : "async"} ${explicit ? "explicit" : "detected"} MicroDVD retains ${input.split("\n")[0]}`, async () => {
        const volume = Volume.fromJSON({ "/input.sub": input });
        const args = ["-v", "error", ...(explicit ? ["-f", "microdvd"] : []),
          "-i", "/input.sub", "-f", "srt", sync ? "/out.srt" : "pipe:1"];
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
        assert.equal(stdout, output);
        assert.equal(volume.readFileSync("/input.sub", "utf8"), input);
      });
    }
  }
}
