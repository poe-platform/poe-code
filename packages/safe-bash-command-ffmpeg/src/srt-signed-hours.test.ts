import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [name, input, expected, detectable] of [
  ["negative zero hour", "1\n-00:00:01,000 --> 00:00:02,000\nalpha\n", "1\n00:00:01,000 --> 00:00:02,000\nalpha", true],
  ["negative hour", "1\n-01:00:00,000 --> 00:00:03,000\nalpha\n", "1\n00:00:00,000 --> 01:00:03,000\nalpha", true],
  ["positive sign", "1\n+00:00:01,000 --> 00:00:02,000\nalpha\n", "1\n00:00:01,000 --> 00:00:02,000\nalpha", false]
] as const) {
  for (const forced of [false, true]) {
    it(`${forced ? "forced" : "probed"} SRT input: ${name}`, async () => {
      const volume = Volume.fromJSON({ "/in.srt": input, "/out.srt": "keep" });
      const args = ["-v", "error", "-y", ...(forced ? ["-f", "srt"] : []), "-i", "/in.srt", "-c:s", "copy", "/out.srt"];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (forced || detectable) {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(volume.readFileSync("/out.srt", "utf8").toString().replaceAll("\r\n", "\n").trimEnd(), expected.trimEnd());
        volume.writeFileSync("/out.srt", "keep");
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        assert.equal(volume.readFileSync("/out.srt", "utf8").toString().replaceAll("\r\n", "\n").trimEnd(), expected.trimEnd());
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.srt", "utf8"), "keep");
      }
    });
  }
}
