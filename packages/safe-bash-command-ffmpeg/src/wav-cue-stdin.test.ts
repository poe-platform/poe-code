import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseFfmetadata } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const target of ["pipe:0", "/input.wav"]) {
  for (const sync of [false, true]) {
    it(`exports WAV cue ends from ${target} (${sync ? "sync" : "async"})`, async () => {
      const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/wav-cue-before-data.wav", import.meta.url));
      // Keep the interval visible even in a millisecond FFmetadata timebase.
      bytes.writeUInt32LE(8, 24);
      bytes.writeUInt32LE(16, 28);
      const volume = Volume.fromJSON({ "/input.wav": bytes });
      const args = ["-y", "-v", "error", "-i", target, "-f", "ffmetadata", "/out.ffmeta"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(bytes, args,
          path => volume.readFileSync(path) as Buffer,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let diagnostic = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () { yield bytes; })(), stdout: { async write() {} },
          stderr: { async write(chunk: Uint8Array) { diagnostic += new TextDecoder().decode(chunk); } }
        } as never);
        assert.equal(result.exitCode, 0, diagnostic);
      }
      const output = volume.readFileSync("/out.ffmeta") as Buffer;
      assert.deepEqual(parseFfmetadata(output).chapters?.map(chapter => ({
        start: chapter.startTimeSeconds, end: chapter.endTimeSeconds, title: chapter.title
      })), [{ start: 0.25, end: target === "pipe:0" ? 0.25 : 0.5, title: "test" }]);
    });
  }
}
