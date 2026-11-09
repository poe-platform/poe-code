import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/utf16.ass", import.meta.url));
for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} detects BOM-marked UTF-16LE ASS and converts it to SRT`, async () => {
    const volume = Volume.fromJSON({ "/utf16.ass": input });
    const args = ["-y", "-v", "error", "-i", "/utf16.ass", "/utf16.srt"];
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
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
    }
    // Native FFmpeg output for the original UTF-16LE bytes.
    assert.equal(volume.readFileSync("/utf16.srt", "utf8"),
      "1\n00:00:01,000 --> 00:00:02,000\nUnicode\n\n");
  });
}
