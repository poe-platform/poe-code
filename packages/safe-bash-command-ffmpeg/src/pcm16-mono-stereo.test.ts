import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of [undefined, "anull", "aformat=sample_fmts=flt"]) {
  for (const format of ["s16le", "framecrc"]) {
    it(`${format} preserves mono-to-stereo mixer precision through ${filter ?? "no filter"}`, async () => {
      const input = Buffer.alloc(2);
      input.writeInt16LE(25669);
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.raw", input);
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          "-bitexact", ...(filter ? ["-af", filter] : []), "-ac", "2", "-f", format, "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      // Native FFmpeg: s16 uses a Q15 gain, while float keeps sqrt(1/2).
      const floating = filter === "aformat=sample_fmts=flt";
      const bytes = Buffer.concat(output);
      if (format === "s16le") {
        assert.equal(bytes.toString("hex"), floating ? "e746e746" : "e646e646");
      } else {
        assert.equal(bytes.toString(), "#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: pcm_s16le\n" +
          "#sample_rate 0: 8000\n#channel_layout_name 0: stereo\n" +
          `0,          0,          0,        1,        4, ${floating ? "0x0682025a" : "0x067c0258"}\n`);
      }
    });
  }
}
