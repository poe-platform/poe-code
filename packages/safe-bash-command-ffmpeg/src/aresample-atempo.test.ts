import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16 at 8000 Hz.
for (const [filter, samples, hash] of [
  ["aresample=11025,atempo=0.75", 3189, "fa35574b6f16083e7d756d81e50123dc8d0222d57a2093b4b2a75273fd46219d"],
  ["aresample=11025,atempo@slow=0.75", 3189, "fa35574b6f16083e7d756d81e50123dc8d0222d57a2093b4b2a75273fd46219d"],
  ["aresample=11025,atempo=0.75,anull", 3189, "fa35574b6f16083e7d756d81e50123dc8d0222d57a2093b4b2a75273fd46219d"],
  ["aformat=sample_fmts=fltp,aresample=11025,atempo=0.75", 3189, "fa35574b6f16083e7d756d81e50123dc8d0222d57a2093b4b2a75273fd46219d"],
  ["aresample=11025,aformat=sample_fmts=s16,atempo=0.75", 3189, "fa35574b6f16083e7d756d81e50123dc8d0222d57a2093b4b2a75273fd46219d"],
  ["aresample=11025", 2481, "f303afd25af55a7e5edae079f31767cd63865edcdb3334bcd72609d23c55accc"]
] as const) {
  for (const graph of [false, true]) {
    it(`negotiates resampler output before ${filter} (graph=${graph})`, async () => {
      const input = Buffer.alloc(1800 * 2);
      for (let i = 0; i < 1800; i++) input.writeInt16LE(i * 701 % 30001 - 15000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(stderr, "");
      assert.equal(output.length / 2, samples);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
