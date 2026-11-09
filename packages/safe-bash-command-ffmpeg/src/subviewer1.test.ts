import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const subviewer1 = "******** START SCRIPT ********\n[00:00:01]\nFirst\n[00:00:03]\nSecond\n[00:00:05]\n";
const expected = "1\n00:00:01,000 --> 00:00:03,000\nFirst\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond\n\n";
for (const sync of [false, true]) {
  for (const forced of [false, true]) {
    for (const format of ["subviewer1", "srt"]) {
      it(`${sync ? "sync" : "async"} ${forced ? "forced" : "detected"} ${format} preserves timing and lines`, async () => {
        const output = format === "srt" ? expected.replace("First\n", "First\nline\n") : expected;
        const volume = Volume.fromJSON({ "/timed.sub": format === "subviewer1" ? subviewer1 : output, "/out.srt": "keep" });
        const args = ["-v", "error", "-y", ...(forced ? ["-f", format] : []), "-i", "/timed.sub", "-c:s", "srt", "/out.srt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(String(volume.readFileSync("/out.srt")).replaceAll("\r\n", "\n"), output);
      });
    }
  }
}
