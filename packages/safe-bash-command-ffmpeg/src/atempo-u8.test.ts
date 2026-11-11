import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 1000 Hz PCM: unsigned sample alignment, blending and EOF.
for (const [format, pattern, length, channels, filter, samples, hash] of [
  ["u8", "mid", 64, 1, "atempo=1", 64, "11ee87c74ef139fae453cc621c3cccc2bf64bb98644364e54b23306a2fe82922"],
  ["u8", "zero", 64, 1, "atempo=1", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["u8", "mid", 64, 1, "anull", 64, "1df1b7ce1fd8fcbe20cde61646875e54fe38d8945ea7911afd59e025cc520a68"],
  ["u8", "mid", 64, 1, "aformat=sample_fmts=s16,atempo=1", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["u8", "ramp", 512, 1, "atempo=2,atempo=0.5", 476, "29c52996f40293b30b4f1eca7e652d6571c8d9c5ae53c4f3c391ed3e9cacda55"],
  ["s16le", "ramp", 512, 1, "atempo=2,atempo=0.5", 512, "1f269483cb2947f387bc195c54a435515ce6e109f47427a9299d4bdca8c486a8"],
  ["u8", "mid", 64, 1, "asendcmd=c='0 atempo tempo 1',atempo=1", 64, "11ee87c74ef139fae453cc621c3cccc2bf64bb98644364e54b23306a2fe82922"],
  ["u8", "ramp", 512, 1, "asendcmd=c='0 atempo tempo 2',atempo=1,atempo=0.5", 532, "af5442837e0dc1f727e79571678186526a003cbbb5b5b3b7d5de6b672dcb97fe"],
  ["u8", "ramp", 512, 2, "atempo=2,atempo=0.5", 497, "aa57f51c2142baeffea57e111d7ee6d95a3615657af36b9b08da9fd74477f477"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches native ${format} ${pattern}, ${channels} channels, ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const bytesPerSample = format === "u8" ? 1 : 2;
      const input = Buffer.alloc(length * channels * bytesPerSample);
      for (let i = 0; i < length * channels; i++) {
        if (format === "u8") input[i] = pattern === "mid" ? 128 : pattern === "zero" ? 0 : (i % 17 - 8) * 4 + 128;
        else input.writeInt16LE((i % 17 - 8) * 1024, i * 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", format, "-ar", "1000", "-ac", String(channels), "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", format, "/out.raw"],
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
      assert.equal(output.length / bytesPerSample / channels, samples);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
