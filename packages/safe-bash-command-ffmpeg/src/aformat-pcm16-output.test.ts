import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav, parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 hashes of the complete raw output for these WAV inputs.
for (const [bits, filter, format, length, hash] of [
  [24, "aformat=sample_fmts=flt", "s16le", 4096, "85c5c91aa7e8be2ef5b3fd16cb45c36651c3260f5a68c9f2e7e665a1595af766"],
  [24, "aformat=sample_fmts=fltp", "s16le", 4096, "85c5c91aa7e8be2ef5b3fd16cb45c36651c3260f5a68c9f2e7e665a1595af766"],
  [16, "aformat=sample_fmts=s32:channel_layouts=stereo", "s16le", 6144, "a2a38ba86b380852ef41719ec0bbffd902286cff276060cf3503353c9eb2c7a5"],
  [16, "aformat=sample_fmts=s32p:channel_layouts=stereo", "s16le", 6144, "a2a38ba86b380852ef41719ec0bbffd902286cff276060cf3503353c9eb2c7a5"],
  [24, "aformat=sample_fmts=flt,aformat=sample_fmts=s16p", "s16le", 4096, "85c5c91aa7e8be2ef5b3fd16cb45c36651c3260f5a68c9f2e7e665a1595af766"],
  [16, "aformat=sample_fmts=s32:channel_layouts=stereo", "s32le", 12288, "e0b3dfa4b2f640ff409b44f49e3dc98ad18118f45ec1c693e832b3c1144f5fd3"],
  [24, "aformat=sample_fmts=flt", "f32le", 8192, "1b54f33026b833c70de578214ad5572d6cda302a842c4dd92b7eb01a0a27e969"]
] as const) {
  for (const [graph, container] of [[false, format], [true, format], [false, "wav"], [true, "wav"]] as const) {
    it(`encodes PCM${bits} through ${filter} to ${format} in ${container} (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100,
        channels: Array.from({ length: bits === 24 ? 2 : 4 }, (_, c) =>
          Float64Array.from({ length: bits === 24 ? 1024 : 1536 }, (_, i) => bits === 24
            ? ((i * 135791 + c * 42163) % 16000000 - 8000000) / 8388608
            : ((i * 421 + c * 1709) % 12000 - 6000) / 32768))
      }, { bitsPerSample: bits }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(container === "wav" ? ["-c:a", `pcm_${format}`] : []), "-f", container, "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const bytes = volume.readFileSync("/out.raw") as Buffer;
      const output = container === "wav"
        ? Buffer.concat(parseAudio(bytes).nodes.filter(node => node.type === "data").map(node => node.data)) : bytes;
      assert.equal(output.length, length);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
