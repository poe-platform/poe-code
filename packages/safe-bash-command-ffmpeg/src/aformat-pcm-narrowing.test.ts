import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete outputs from native FFmpeg 7.0.2 for stereo PCM24 at 44.1 kHz.
for (const [filter, format, hash] of [
  ["aformat=sample_fmts=s16", "s16le", "43ed37c6896c0f3353c4d1f4e359dd31118380918861e909ad0a4370f8538df0"],
  ["aformat=sample_fmts=s16p", "s16le", "43ed37c6896c0f3353c4d1f4e359dd31118380918861e909ad0a4370f8538df0"],
  ["aformat=sample_fmts=s16,earwax", "s16le", "b309094b559114a1096992eb59576c9a73af5d53a58321743206697997785a46"],
  ["aformat=sample_fmts=s16p", "s32le", "70b9a9e54357173b753df7e4f76e0d6b9753c3416de66f1489d9c0b8bc87afbd"],
  ["aformat=sample_fmts=s32", "s16le", "43ed37c6896c0f3353c4d1f4e359dd31118380918861e909ad0a4370f8538df0"],
  ["aformat=sample_fmts=s32,earwax", "s16le", "b309094b559114a1096992eb59576c9a73af5d53a58321743206697997785a46"],
  ["aformat=sample_fmts=flt,aformat=sample_fmts=s16p", "s16le", "85c5c91aa7e8be2ef5b3fd16cb45c36651c3260f5a68c9f2e7e665a1595af766"],
  ["aresample=osf=s16", "s16le", "43ed37c6896c0f3353c4d1f4e359dd31118380918861e909ad0a4370f8538df0"],
  ["aresample=osf=s16p", "s32le", "70b9a9e54357173b753df7e4f76e0d6b9753c3416de66f1489d9c0b8bc87afbd"]
] as const) {
  for (const graph of [false, true]) {
    it(`narrows PCM24 through ${filter} to ${format} (${graph ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      const channels = [0, 1].map(channel => Float64Array.from({ length: 1024 }, (_, i) =>
        ((i * 135791 + channel * 42163) % 16000000 - 8000000) / 8388608));
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100, channels }, { bitsPerSample: 24 }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
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
      assert.equal(output.length, 1024 * 2 * (format === "s16le" ? 2 : 4));
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
