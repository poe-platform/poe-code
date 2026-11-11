import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [name, input, expected] of [
  ["missing end", "[10][]Alpha\n[30][40]Beta\n",
    "WEBVTT\n\n00:01.000 --> 00:03.000\nAlpha\n\n00:03.000 --> 00:04.000\nBeta\n"],
  ["earlier end", "[20][10]Alpha\n[30][40]Beta\n",
    "WEBVTT\n\n00:02.000 --> 00:03.000\nAlpha\n\n00:03.000 --> 00:04.000\nBeta\n"],
  ["explicit end", "[10][30]Alpha\n[30][40]Beta\n",
    "WEBVTT\n\n00:01.000 --> 00:03.000\nAlpha\n\n00:03.000 --> 00:04.000\nBeta\n"],
  ["out-of-order missing end", "[30][40]Beta\n[10][]Alpha\n",
    "WEBVTT\n\n00:01.000 --> 00:03.000\nAlpha\n\n00:03.000 --> 00:04.000\nBeta\n"]
]) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} MPL2 recovers ${name} cue timing in WebVTT`, async () => {
      const volume = Volume.fromJSON({ "/input.txt": input! });
      const args = ["-v", "error", "-f", "mpl2", "-i", "/input.txt", "-f", "webvtt", sync ? "/out.vtt" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out.vtt", "utf8").toString();
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
      assert.equal(volume.readFileSync("/input.txt", "utf8"), input);
    });
  }
}
