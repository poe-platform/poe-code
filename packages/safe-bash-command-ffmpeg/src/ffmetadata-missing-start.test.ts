import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const denominator of [1, 10]) {
  for (const explicit of [false, true]) {
    it(`exports recovered chapter starts (denominator=${denominator}, explicit=${explicit})`, async () => {
      const prefix = ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=1\nEND=2\ntitle=A\n";
      const chapter = `[CHAPTER]\nTIMEBASE=1/${denominator}\n`;
      const end = `END=${8 * denominator}\ntitle=B\n`;
      const volume = Volume.fromJSON({ "/in.meta": `${prefix}${chapter}${explicit ? "START=4\n" : ""}${end}` });
      let stdout = "";
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.meta", "-bitexact", "-f", "ffmetadata", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stdout, `${prefix}${chapter}START=${explicit ? 4 : 2}\n${end}`);
      assert.equal(stderr, explicit ? "" : `[ffmetadata] Expected chapter start timestamp, found END=${8 * denominator}.\n`);
    });
  }
}
