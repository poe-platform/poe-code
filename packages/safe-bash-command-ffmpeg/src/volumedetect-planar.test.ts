import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  for (const format of ["s16p", "s16", "fltp"]) {
    it(`volumedetect forwards ${format} with ${channels} channels as signed 16-bit PCM`, async () => {
      const input = Buffer.from("00400000002000100008000400020001", "hex");
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
          "-af", `aformat=sample_fmts=${format},volumedetect,ashowinfo`, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(fs.readFileSync("/out.raw"), input);
      // Native FFmpeg preserves s16p, but negotiates fltp to packed s16.
      const outputFormat = format === "s16p" ? "s16p" : "s16";
      const planarStereo = outputFormat === "s16p" && channels === 2;
      assert.ok(stderr.includes(`fmt:${outputFormat} channels:${channels}`), stderr);
      assert.ok(stderr.includes(`nb_samples:${8 / channels} checksum:${planarStereo ? "0627007F" : "0603007F"} plane_checksums: [ ${planarStereo ? "027A006A 005D0015" : "0603007F"} ]`), stderr);
      assert.ok(stderr.includes("n_samples: 8\nmean_volume: -13.8 dB\nmax_volume: -6.0 dB\n"), stderr);
    });
  }
}
