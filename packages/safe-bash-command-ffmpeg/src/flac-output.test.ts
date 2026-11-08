import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const options of [["-c:a", "pcm_s16le"], ["-map", "0:a", "-map", "0:a", "-c", "copy"]]) {
  it(`rejects invalid FLAC output: ${options.join(" ")}`, async () => {
    const input = readFileSync(new URL("./fixtures/trim-16.flac", import.meta.url));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.flac", input);
    const args = ["-v", "error", "-i", "/in.flac", ...options, "/out.flac"];
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.equal(volume.existsSync("/out.flac"), false);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("Exactly one FLAC audio stream"), stderr);
    assert.equal(volume.existsSync("/out.flac"), false);
  });
}
