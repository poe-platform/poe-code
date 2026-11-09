import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const first = "00:00:01,000 --> 00:00:02,000\nalpha\n";
const second = "00:00:01,500 --> 00:00:03,000\nbeta\n";
for (const [name, input, expected, detectable] of [
  ["noarrowspace", "1\n00:00:01,000-->00:00:02,000\nalpha\n", "1\n" + first, false],
  ["tabarrow", "1\n00:00:01,000\t-->\t00:00:02,000\nalpha\n", "1\n" + first, false],
  ["ok", "1\n" + first + "\n2\n" + second, "1\n" + first + "\n2\n" + second, true]
] as const) {
  for (const forced of [false, true]) {
    it(`${forced ? "forced" : "probed"} SRT input: ${name}`, async () => {
      const volume = Volume.fromJSON({ "/in.srt": input, "/out.srt": "keep" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", ...(forced ? ["-f", "srt"] : []), "-i", "/in.srt", "-c:s", "copy", "/out.srt"],
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
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.srt", "utf8"), "keep");
      }
    });
  }
}
