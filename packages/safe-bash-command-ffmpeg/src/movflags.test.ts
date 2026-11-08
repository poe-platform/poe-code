import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const flags of ["+not_a_flag", "+faststart+not_a_flag", "+not_faststart", "-not_a_flag"]) {
    for (const existing of [false, true]) {
      it(`rejects ${flags} without writing media (sync=${sync}, existing=${existing})`, async () => {
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(createSyntheticMp4({ width: 64, height: 48, frameCount: 2, fps: 2, includeAudio: false })) });
        if (existing) volume.writeFileSync("/out.mp4", "existing data");
        const args = ["-y", "-i", "/in.mp4", "-c", "copy", "-movflags", flags, "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
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
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("movflags"), stderr);
        }
        assert.equal(volume.existsSync("/out.mp4"), existing);
        if (existing) assert.equal(volume.readFileSync("/out.mp4", "utf8"), "existing data");
      });
    }
  }
}
