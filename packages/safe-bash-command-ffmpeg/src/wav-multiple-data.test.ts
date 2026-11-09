import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Unchanged native FFmpeg 7.0.2 fixtures: a pipe reads both data chunks;
// a seekable filename starts at the last one. The gap contains padded JUNK.
for (const fixture of ["wav-multiple-data.wav", "wav-multiple-data-gap.wav"]) {
  for (const target of ["pipe:0", "/input.wav"]) {
    for (const codec of ["pcm_s16le", "copy"]) {
      it(`reads ${fixture} from ${target} with ${codec}`, async () => {
        const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
        const volume = Volume.fromJSON({ "/input.wav": bytes });
        let diagnostic = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", target, "-c:a", codec, "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); }
          },
          stdin: (async function* () { for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3); })(),
          stdout: { async write() { assert.fail("Expected file output"); } },
          stderr: { async write(chunk: Uint8Array) { diagnostic += new TextDecoder().decode(chunk); } }
        } as never);
        assert.equal(result.exitCode, 0, diagnostic);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          target === "pipe:0" ? [101, 102, 103, 104, -501, -502, -503] : [-501, -502, -503]);
        let syncOutput: Uint8Array | undefined;
        const sync = evalSyncFfmpeg(target === "pipe:0" ? bytes : undefined,
          ["-y", "-v", "error", "-i", target, "-c:a", codec, "-f", "s16le", "/sync.raw"], () => bytes,
          (_path, data) => { syncOutput = data; return true; });
        assert.equal(sync, "");
        assert.deepEqual(Buffer.from(syncOutput!), output);
      });
    }
  }
}
