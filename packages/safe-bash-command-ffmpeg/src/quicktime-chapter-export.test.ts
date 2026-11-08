import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg: three seconds of 48 kHz AAC sine audio, with A (0–1s) and B
// (1–3s) chapters. quicktime-only.mp4 uses -movflags +disable_chpl; dual.mp4
// uses the default muxer and includes both QuickTime and Nero chapters.
for (const fixture of ["quicktime-only", "dual"]) {
  for (const sync of [false, true]) {
    it(`exports ${fixture} MP4 chapters to FFmetadata (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({
        "/in.mp4": readFileSync(new URL(`./fixtures/chapters/${fixture}.mp4`, import.meta.url))
      });
      const args = ["-v", "error", "-i", "/in.mp4", "-f", "ffmetadata", "/export.meta"];
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
      const exported = volume.readFileSync("/export.meta", "utf8") as string;
      assert.deepEqual(exported.split("[CHAPTER]").slice(1).map(chapter => chapter.trim()), [
        "TIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=A",
        "TIMEBASE=1/1000\nSTART=1000\nEND=3000\ntitle=B"
      ]);
    });
  }
}
