import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 12 }, (_, index) => index + 1);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

for (const complex of [false, true]) {
  for (const framing of ["", "asetnsamples=n=2:p=0,"]) {
    for (const [filter, cut, expected] of [
      ["asetpts=PTS+5", ["-ss", "0.003", "-t", "0.005"], samples.slice(0, 3)],
      ["asetpts=PTS+5", ["-ss", "0.003", "-to", "0.008"], samples.slice(0, 3)],
      ["asetpts=PTS+5", ["-ss", "0.003"], samples],
      ["anull", ["-ss", "0.003", "-t", "0.005"], samples.slice(3, 8)],
      ["asetpts=PTS+5", ["-ss", "0", "-t", "0.008"], samples.slice(0, 3)],
      ["asetpts=PTS+5", ["-ss", "0.007", "-t", "0.005"], samples.slice(2, 7)],
      ["asetpts=PTS+5", ["-ss", "0.003", "-t", "0.001"], []],
      ["asetpts=PTS-5", ["-ss", "0.003", "-t", "0.005"], samples.slice(8)]
    ] as const) {
      it(`clips ${framing}${filter} to ${cut.join(" ")} (${complex ? "complex" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const chain = `${framing}${filter}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
            ...cut, "-f", "s16le", "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      });
    }
  }
}
