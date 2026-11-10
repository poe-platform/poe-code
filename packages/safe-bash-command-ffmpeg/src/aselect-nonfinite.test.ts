import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// The reported FFmpeg 7.0.2 fixture uses three-sample frames except for the last frame.
const all = [101, 114, 127, 140, 153, 166, 179, 192, 205, 218];
for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["asetpts=NAN,aselect='isnan(t)'", all],
    ["areverse,aselect='isnan(t)'", []],
    ["aselect='0/0'", all],
    ["aselect='1/0'", all],
    ["aselect='isnan(0/0)'", all],
    ["aselect='isinf(1/0)'", all],
    ["aselect='-1'", all],
    ["aselect='0'", []],
    ["aselect='-1/0'", all],
    ["aselect='isinf(-1/0)'", all],
    ["aselect='not(isinf(1/0))'", []],
    ["aselect='isinf(1/(n-1))'", all.slice(3, 6)],
    ["atrim=end_sample=0,aselect='1/0'", []],
    ["aselect='isinf(1/0)+unknown'", null],
    ["aselect='isinf(1/0'", null],
    ["aselect='isinf(1/0,0)'", null],
    ["atrim=end_sample=0,aselect='isinf(1/0)+unknown'", null]
  ] as const) {
    it(`aselect handles nonfinite values: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(all.length * 2);
      for (const [i, sample] of all.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      const before = volume.toJSON();
      const chain = `asetnsamples=n=3:p=0,${filter}`;
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
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("aselect:"), stderr);
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.dat") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      }
    });
  }
}
