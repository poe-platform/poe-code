import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { readFileSync } from "node:fs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native ALAC MOV with three packets, including an eight-frame tail.
const alacMov = readFileSync(new URL("../../mp4-ast/src/fixtures/caf-alac-copy.mov", import.meta.url));

for (const sync of [false, true]) {
  it(`copies MOV ALAC to a lossless seekable CAF (${sync ? "sync" : "async"})`, async () => {
    const volume = Volume.fromJSON({ "/out.caf": "keep" });
    volume.writeFileSync("/in.mov", alacMov);
    const args = ["-v", "error", "-y", "-i", "/in.mov", "-c:a", "copy", "/out.caf"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
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
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { input: volume.readFileSync("/out.caf") });
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    assert.equal(decoded.stdout.length, 32800);
    assert.equal(createHash("sha256").update(decoded.stdout).digest("hex"), "50d5595b384041baf4e0d17bef38434d327019e750cd522c87b3cf80a6fc41bf");
  });
}
