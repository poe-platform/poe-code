import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({ sampleRate: 1000, channels: [
  Float64Array.from({ length: 16 }, (_, i) => (1000 + i * 97) / 32768),
  Float64Array.from({ length: 16 }, (_, i) => ((i * 257) % 20001 - 10000) / 32768)
] });

// Native FFmpeg 7.0.2: floating filters retain all 16 stereo samples;
// unchanged PCM16 and conversion back to integers fail the Max_level < 1 selector.
for (const [prefix, peak, hash] of [
  ["flanger,", "0.074919", "3ec023179765761e298eee4e944b7840182d88d5f0dd54600ccac901ccd75908"],
  ["aformat=sample_fmts=dblp,", "0.074921", "a045d62511e11c38ccc5cef1f1001968a904d613e6c746af4f27fcda0c61cfcf"],
  ["volume=1:precision=double,", "0.074921", "a045d62511e11c38ccc5cef1f1001968a904d613e6c746af4f27fcda0c61cfcf"],
  ["flanger,volume=1:precision=double,", "0.074919", "3ec023179765761e298eee4e944b7840182d88d5f0dd54600ccac901ccd75908"],
  ["", "2455.000000", ""],
  ["aformat=dblp,aformat=s16,", "2455.000000", ""],
  ["volume=1:precision=double,aformat=s32,", "160890880.000000", ""]
]) {
  for (const graph of [false, true]) {
    it(`measures astats in the current sample format after ${prefix || "PCM16 input"} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const stdout: Buffer[] = [];
      let stderr = "";
      const key = "lavfi.astats.1.Max_level";
      const filter = `${prefix}astats=metadata=1,ametadata=print:key=${key}:file=/tags.txt,ametadata=select:key=${key}:value=1:function=less`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(stdout);
      assert.equal(output.length, hash ? 64 : 0);
      if (hash) assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      assert.equal(volume.readFileSync("/tags.txt", "utf8"), `frame:0    pts:0       pts_time:0\n${key}=${peak}\n`);
    });
  }
}
