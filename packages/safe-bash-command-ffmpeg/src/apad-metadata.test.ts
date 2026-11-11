import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [length, filters, expected] of [
    [4, "apad=pad_len=2,areverse", [2, 1]],
    [11, "apad=pad_len=7:packet_size=2,areverse", [2, 1]],
    [4, "apad=pad_len=0,areverse", [2, 1]],
    [4, "areverse", [2, 1]],
    [4, "areverse,apad=pad_len=2", [2, 1]],
    [4, "apad=pad_len=2", [1, 2]],
    [4, "apad=pad_len=2,areverse,areverse", [1, 2]]
  ] as const) {
    it(`keeps tagged input audio through ${filters} (${length} samples, complex=${complex})`, async () => {
      const input = Buffer.alloc(length * 2);
      for (let i = 0; i < length; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chain = `asetnsamples=2:0,ametadata=add:k:y:enable='eq(n,0)',${filters},ametadata=select:k:y`;
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}
