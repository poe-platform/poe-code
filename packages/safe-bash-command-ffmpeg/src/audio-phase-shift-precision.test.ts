import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 4096 mono PCM16 samples at 8 kHz.
for (const [filter, format, hash] of [
  ["afreqshift=100", "dbl", "8c6431f93548d7f2c6e86279f08f68993926839660aa04840d0af7b431205a89"],
  ["afreqshift=100", "flt", "8286e23a70fdaa1ed520c9292c43d36457915ef9010b0708d6a716a01224f80f"],
  ["aphaseshift=shift=0.2", "dbl", "67195cc85bffa1a279d814e1b57cef8879b56ec2b4bafe7b0d817b74dea4f4e0"],
  ["aphaseshift=shift=0.2", "flt", "4cd52203882762d800ab0d68827d3768ca8198e6f39319246e2561c5e95b56ee"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} honors upstream ${format} precision (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 4096 }, (_, i) => ((i * 179 % 50001) - 25000) / 32768)
      ] }));
      const chain = `aformat=sample_fmts=${format},${filter}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "/out.raw"],
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
      assert.equal(output.length, 8192);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
