import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} exports native MP4 style ranges to SRT`, async () => {
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/timed-text-styles.mp4", import.meta.url));
    const volume = Volume.fromJSON({ "/in.mp4": input });
    const args = ["-y", "-v", "error", "-i", "/in.mp4", "/out.srt"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    assert.equal(volume.readFileSync("/out.srt", "utf8"),
      "1\n00:00:00,250 --> 00:00:01,125\nPlain <i>slant</i> <b>bold</b>\nNext line\n\n");
  });
}
