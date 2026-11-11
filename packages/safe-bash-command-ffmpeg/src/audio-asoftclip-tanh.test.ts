import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 Linux x86-64 references for PCM16 input 8001.
for (const [filter, expected] of [
  ["asoftclip=type=tanh", 514175584],
  ["aformat=sample_fmts=fltp,asoftclip=type=tanh", 514175584],
  ["aformat=sample_fmts=dblp,asoftclip=type=tanh", 514175615],
  ["aformat=sample_fmts=fltp,asoftclip=type=hard", 524353536]
] as const) for (const graph of [false, true]) {
  it(`${filter} preserves native precision for PCM16 input 8001 (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.of(8001 / 32768)] }));
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s32le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const pcm = Buffer.concat(output);
    assert.equal(pcm.length, 4);
    assert.equal(pcm.readInt32LE(), expected);
  });
}

// Full native FFmpeg 7.0.2 PCM32 output, including both signs and saturation.
for (const [format, count, hash] of [
  ["s16le", 65536, "8fbc3a4fafffd9ff53b754421e17b2183e100e21dd9ef4f49b7d292f6d8dced2"],
  ["f32le", 65537, "e391ecf2516dd9ab4815f75e0cadca61ea1a94f345208e8e3e6060e00da0589b"]
] as const) {
  it(`asoftclip tanh matches the native ${format} sweep`, async () => {
    const input = Buffer.alloc(count * (format === "s16le" ? 2 : 4));
    for (let i = 0; i < count; i++) {
      if (format === "s16le") input.writeInt16LE(i - 32768, i * 2);
      else input.writeFloatLE((i - 32768) / 1024, i * 4);
    }
    const fs = Volume.fromJSON({ "/in.pcm": input });
    const output: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
        "-af", "asoftclip=type=tanh", "-f", "s32le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(createHash("sha256").update(Buffer.concat(output)).digest("hex"), hash);
  });
}
