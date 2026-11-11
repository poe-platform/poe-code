import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static references, also verified with -cpuflags 0.
for (const [filter, expected] of [
  ["anull", "00000000a06ecd0f40cbc0d300398e63"],
  ["asoftclip=type=tanh", "000000000001b90fc0666fd580096253"]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native float clipping before PCM32 output (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(16);
    [0, .123456789, -.34567891, .77777777].forEach((sample, i) => input.writeFloatLE(sample, i * 4));
    const fs = Volume.fromJSON({ "/in.pcm": input });
    let stderr = "";
    const output: Buffer[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f32le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
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
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}

// FFmpeg 7.0.2 Linux x86-64 references for PCM16 input 8001.
for (const [filter, expected] of [
  ["asoftclip=type=alg", 509388640],
  ["aformat=sample_fmts=fltp,asoftclip=type=alg", 509388640],
  ["aformat=sample_fmts=dblp,asoftclip=type=alg", 509388599],
  ["asoftclip=type=exp", 514175488],
  ["aformat=sample_fmts=fltp,asoftclip=type=exp", 514175488],
  ["aformat=sample_fmts=dblp,asoftclip=type=exp", 514175615],
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
