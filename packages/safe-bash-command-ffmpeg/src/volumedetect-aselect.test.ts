import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 measures every input frame read to find a selected output.
for (const [selection, limit, count, mean, output] of [
  ["aselect=eq(n\\,0)", 1, 2, "-9.0", "00400000"],
  ["aselect=eq(n\\,1)", 1, 4, "-10.9", "00200010"],
  ["aselect=eq(n\\,2)", 1, 6, "-12.6", "00080004"],
  ["aselect=eq(n\\,2)", undefined, 8, "-13.8", "00080004"],
  ["aselect=0", 1, 8, "-13.8", ""],
  ["aselect=gte(n\\,1)", 2, 6, "-12.6", "0020001000080004"],
  ["anull,volume@pass=1,acopy,aselect@pick=eq(n\\,2)", 1, 6, "-12.6", "00080004"],
  ["aselect=gte(t\\,0.0005)", 1, 6, "-12.6", "00080004"],
  ["aselect=eq(st(0\\,ld(0)+1)\\,3)", 1, 6, "-12.6", "00080004"]
] as const) {
  for (const graph of [false, true]) {
    it(`volumedetect counts frames consumed by ${selection}, limit ${limit}, graph=${graph}`, async () => {
      const fs = Volume.fromJSON({ "/in.raw": Buffer.from("00400000002000100008000400020001", "hex") });
      let stderr = "";
      const chunks: Uint8Array[] = [];
      const filter = `asetnsamples=n=2:p=0,volumedetect,${selection}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(limit === undefined ? [] : ["-frames:a", String(limit)]), "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(chunks).toString("hex"), output);
      assert.equal(stderr, `n_samples: 0\nn_samples: ${count}\nmean_volume: ${mean} dB\nmax_volume: -6.0 dB\n`);
    });
  }
}
