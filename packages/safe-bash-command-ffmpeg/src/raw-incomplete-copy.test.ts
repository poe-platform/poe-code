import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg preserves even a lone incomplete PCM sample during stream copy.
for (const format of ["s16le", "wav"]) {
  for (const size of [0, 1, 8000, 8001, 1025]) {
    it(`copies ${size} raw PCM bytes to ${format}`, async () => {
      const input = Buffer.alloc(size, 0x5a);
      const volume = Volume.fromJSON({ "/input.raw": input });
      const args = ["-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/input.raw",
        "-c:a", "copy", "-f", format, "/output"];
      const verify = () => {
        const output = volume.readFileSync("/output") as Buffer;
        const pcm = format === "wav"
          ? Buffer.concat(parseWav(output, { decodeAudio: false }).tracks[0]!.samples.map(sample => sample.data)) : output;
        assert.deepEqual(pcm, input);
      };
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
      verify();
      const sync = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      if (sync !== undefined) { assert.equal(sync, ""); verify(); }
    });
  }
}
