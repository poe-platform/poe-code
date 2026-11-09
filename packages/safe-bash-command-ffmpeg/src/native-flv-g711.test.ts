import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg fixtures, with codes.raw containing every byte from 0 through 255:
// ffmpeg -f LAW -ar 8000 -ac 1 -i codes.raw -c:a copy -f flv g711-LAW.flv
// ffmpeg -i g711-LAW.flv -c:a pcm_s16le -f s16le g711-LAW.pcm
for (const law of ["mulaw", "alaw"]) {
  for (const copy of [true, false]) {
    it(`${copy ? "copies" : "decodes"} every ${law} code from native FLV`, async () => {
      const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/g711-${law}.flv`, import.meta.url));
      const expected = copy
        ? Buffer.from(Array.from({ length: 256 }, (_, i) => i))
        : readFileSync(new URL(`../../mp4-ast/src/fixtures/g711-${law}.pcm`, import.meta.url));
      const volume = Volume.fromJSON({ "/in.flv": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.flv", "-c:a", copy ? "copy" : "pcm_s16le", "-f", copy ? law : "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: volume.promises,
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(expected.length, copy ? 256 : 512);
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    });
  }
}
