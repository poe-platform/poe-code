import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 references for f=20:g=3 and f=10:g=3.
// Named options do not advance the positional option cursor.
for (const [options, hash] of [
  ["f=20:g=3", "9b21f6adb0f70cb0fb856031f329c24cb13ff946c6b9232bfa08ba4d40951edf"],
  ["f=10:g=3:20", "9b21f6adb0f70cb0fb856031f329c24cb13ff946c6b9232bfa08ba4d40951edf"],
  ["framelen=10:gausssize=3:20", "9b21f6adb0f70cb0fb856031f329c24cb13ff946c6b9232bfa08ba4d40951edf"],
  ["20:g=5:3", "9b21f6adb0f70cb0fb856031f329c24cb13ff946c6b9232bfa08ba4d40951edf"],
  ["20:3", "9b21f6adb0f70cb0fb856031f329c24cb13ff946c6b9232bfa08ba4d40951edf"],
  ["f=10:g=5:p=0.1:m=2:20:3:0.95:10", "9b21f6adb0f70cb0fb856031f329c24cb13ff946c6b9232bfa08ba4d40951edf"],
  ["20:g=3:f=10", "edd66bebed21c08fa8edd22df980ee19488921dd9a5cfbe84cd3659a2a1fb33a"]
]) for (const graph of [false, true]) {
  it(`dynaudnorm=${options} resolves mixed options (${graph ? "graph" : "simple"})`, async () => {
    const samples = Float64Array.from({ length: 120 }, (_, i) =>
      (i % 2 ? 1 : -1) * (i < 60 ? 500 : 5000) / 32768);
    const fs = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({
      sampleRate: 1000, channels: [samples, samples.map(value => value * 4)]
    })) });
    const filter = `dynaudnorm=${options}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
        : ["-af", filter]), "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, 480);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
