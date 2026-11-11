import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = "1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n";

for (const sync of [false, true]) {
  for (const [options, expected] of [
    [["-ss", "2", "-c:s", "copy"], "1\n00:00:01,000 --> 00:00:02,000\nB\n\n"],
    [["-ss", "2"], "1\n00:00:03,000 --> 00:00:04,000\nB\n\n"],
    [["-c:s", "copy"], input + "\n"]
  ] as const) {
    it(`${sync ? "sync" : "async"} SRT output ${options.join(" ")}`, async () => {
      const volume = Volume.fromJSON({ "/in.srt": input });
      const args = ["-v", "error", "-i", "/in.srt", ...options, "-f", "srt", sync ? "/out.srt" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        stdout = volume.readFileSync("/out.srt", "utf8") as string;
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); } },
          stdin: (async function* () {})(),
          stdout: { async write(data: Uint8Array) { stdout += new TextDecoder().decode(data); } },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(stdout, expected);
    });
  }
}
