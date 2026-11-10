import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM results measured with FFmpeg 7.0.2, including the short final frame.
const samples = [101, 114, 127, 140, 153, 166, 179, 192, 205, 218];
for (const complex of [false, true]) {
  for (const [expression, expected] of [
    ["eq(key,1)", samples],
    ["eq(key,0)", []],
    ["isnan(pict_type)", samples],
    ["isnan(interlace_type)", samples],
    ["isnan(concatdec_select)", samples],
    ["eq(pict_type,I)", []],
    ["eq(interlace_type,PROGRESSIVE)", []],
    ["1", samples],
    ["0", []]
  ] as const) {
    it(`aselect exposes PCM classification: ${expression} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      for (const [i, sample] of samples.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,aselect='${expression}'`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
          "-f", "s16le", "/out.dat"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.dat") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
