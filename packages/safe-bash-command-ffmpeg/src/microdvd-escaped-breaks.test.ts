import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Complete stdout captured from native FFmpeg 7.0.2, including CRLF dialogue breaks.
const fixtures = [
  {
    input: "{1}{1}25\n{25}{50}A\\NB\n",
    expected: "1\n00:00:01,000 --> 00:00:02,000\nA\r\nB\n\n"
  },
  ...["\\n", "|"].map(separator => ({
    input: `{25}{50}A${separator}B\n{25}{50}First\n{75}{100}Last\n`,
    expected: "1\n00:00:01,043 --> 00:00:02,086\nA\r\nB\n\n2\n00:00:01,043 --> 00:00:02,086\nFirst\n\n3\n00:00:03,128 --> 00:00:04,171\nLast\n\n"
  }))
];

for (const sync of [false, true]) {
  for (const { input, expected } of fixtures) {
    it(`${sync ? "sync" : "async"} MicroDVD escaped breaks match native SRT: ${JSON.stringify(input)}`, async () => {
      const volume = Volume.fromJSON({ "/in.sub": input });
      const args = ["-v", "error", "-f", "microdvd", "-i", "/in.sub", "-f", "srt", sync ? "/out.srt" : "pipe:1"];
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
      assert.equal(stdout, expected);
      assert.equal(volume.readFileSync("/in.sub", "utf8"), input);
    });
  }
}
