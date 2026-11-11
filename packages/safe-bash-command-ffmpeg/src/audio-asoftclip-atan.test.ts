import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 Linux x86-64 references for PCM16 input 8001.
for (const [filter, expected] of [
  ["asoftclip=type=atan", 327407552],
  ["aformat=sample_fmts=fltp,asoftclip=type=atan", 327407552],
  ["aformat=sample_fmts=dblp,asoftclip=type=atan", 327407534],
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
