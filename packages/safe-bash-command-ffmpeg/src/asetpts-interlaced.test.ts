import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [filter, samples] of [
    ["asetpts=PTS+INTERLACED,atrim=end_pts=6", [1, 2, 3, 4, 5, 6]],
    ["asetpts=PTS,atrim=end_pts=6", [1, 2, 3, 4, 5, 6]],
    ["atrim=end_sample=0,asetpts=PTS+INTERLACED", []]
  ] as const) {
    it(`resolves audio INTERLACED as zero through ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chain = `asetnsamples=3:0,${filter}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[s]`, "-map", "[s]"] : ["-af", chain]),
          "-f", "s16le", "/out.raw"],
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), samples);
    });
  }
}
