import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7: copy includes whole 512-frame packets; encoding ends at sample 800.
for (const codec of ["copy", "pcm_s16le"]) for (const format of ["s16le", "wav"]) {
  for (const placement of ["input", "output"]) for (const duration of [undefined, "0", "0.1", "0.064", "1"]) {
    it(`raw ${codec} to ${format}: ${placement} duration ${duration}`, async () => {
      const input = Buffer.alloc(8000);
      for (let i = 0; i < 4000; i++) input.writeInt16LE(i, i * 2);
      const volume = Volume.fromJSON({ "/input.raw": input });
      const limit = duration === undefined ? [] : ["-t", duration];
      const args = ["-f", "s16le", "-ar", "8000", "-ac", "1",
        ...(placement === "input" ? limit : []), "-i", "/input.raw",
        ...(placement === "output" ? limit : []), "-c:a", codec, "-f", format, "/output"];
      const frames = duration === undefined ? 4000 : Math.min(4000,
        codec === "copy" ? Math.ceil(Number(duration) * 8000 / 512) * 512 : Number(duration) * 8000);
      const verify = () => {
        const output = volume.readFileSync("/output") as Buffer;
        const pcm = format === "wav"
          ? Buffer.concat(parseWav(output).tracks[0]!.samples.map(sample => sample.data)) : output;
        assert.deepEqual(pcm, input.subarray(0, frames * 2));
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
