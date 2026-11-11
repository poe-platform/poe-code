import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [start, expected] of [
    ["00:01.004", "00:01.00"],
    ["00:01.005", "00:01.01"],
    ["00:01.006", "00:01.01"],
    ["00:01.015", "00:01.02"],
    ["00:01.999", "00:02.00"]
  ]) {
    it(`${sync ? "sync" : "async"} rounds WebVTT ${start} to LRC ${expected}`, async () => {
      const volume = Volume.fromJSON({
        "/in.vtt": `WEBVTT\n\ncue-1\n${start} --> 00:02.500 align:start position:20%\nhello\n\n`
      });
      const args = ["-v", "error", "-i", "/in.vtt", "-bitexact", "-f", "lrc", sync ? "/out.lrc" : "pipe:1"];
      let output = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        output = volume.readFileSync("/out.lrc", "utf8").toString();
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
      assert.deepEqual(output.split("\n").filter(line => line.endsWith("hello")), [`[${expected}]hello`]);
    });
  }
}
