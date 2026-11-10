import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Decoded RGBA hashes from native FFmpeg 7.0.2, independent of PNG compression.
const original = "0c1b0a28714a0e3725c4b36e0176198d12e20709b43e5aeb729215a5b110dd95";
const reversed = "8783177eea8fee331581d2c0c6dd333184710bc10c8bf1284d9c1435298ffd73";
const silent = "5341e6b2646979a70e57653007a1f310169421ec9bdd9f1a5648f75ade005af1";

for (const [before, after, hash] of [
  ["", "", original],
  ["volume=0,", "", silent],
  ["areverse,", "", reversed],
  ["areverse,areverse,", "", original],
  ["areverse,", ",hflip", original],
  ["volume='if(1,0,1)',areverse,", "", silent]
]) {
  for (const labeled of [false, true]) {
    it(`applies upstream audio filters to showwavespic: ${before} / ${after}, labeled=${labeled}`, async () => {
      const channels = [
        Float64Array.from({ length: 32 }, (_, i) => [1000, -1000, 4000, -8000, 16000, -16000, 32000, -32000][i % 8]! / 32768),
        Float64Array.from({ length: 32 }, (_, i) => [24000, -2000, 12000, -24000][i % 4]! / 32768)
      ];
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })),
        "/silent.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float64Array(32)] }))
      });
      const expression = `${before}showwavespic=s=8x8:split_channels=1${after}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(labeled ? ["-i", "/silent.wav"] : []), "-i", "/in.wav",
          "-filter_complex", labeled ? `[1:a:0]${expression}[pic]` : expression,
          ...(labeled ? ["-map", "[pic]"] : []), "-frames:v", "1", "/out.png"],
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
      const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
      assert.equal(output.width, 8);
      assert.equal(output.height, 8);
      assert.equal(createHash("sha256").update(output.data).digest("hex"), hash);
    });
  }
}
