import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const existing of [false, true]) {
  it(`rejects unsupported MP4 segments without writing pictures (existing=${existing})`, async () => {
    const volume = Volume.fromJSON({
      "/in.mp4": Buffer.from(createSyntheticMp4({ width: 32, height: 32, frameCount: 20 })),
      ...(existing ? { "/p00.mp4": "keep first", "/p01.mp4": "keep second" } : {})
    });
    const before = volume.toJSON();
    const args = ["-y", "-v", "error", "-i", "/in.mp4", "-c", "copy", "-f", "segment", "/p%02d.mp4"];
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.deepEqual(volume.toJSON(), before);
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
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("segment output requires a single audio track and WAV filenames"), stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
