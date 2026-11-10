import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 preserves PCM, including the short final frame, with missing PTS.
for (const expression of ["1/0", "-1/0", "NAN", "0/0", "PTS", "abs(-1/0)"]) {
  for (const frames of [undefined, 1]) {
    for (const complex of [false, true]) {
      it(`renders asetpts=${expression} PCM (frames=${frames ?? "all"}, complex=${complex})`, async () => {
        const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027f82a", "hex");
        const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const filter = `asetnsamples=n=3:p=0,asetpts=${expression}`;
        let error = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...(frames === undefined ? [] : ["-frames:a", String(frames)]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { error += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, error);
        assert.deepEqual(fs.readFileSync("/out.raw"), frames === undefined ? input : input.subarray(0, 6));
      });
    }
  }
}
