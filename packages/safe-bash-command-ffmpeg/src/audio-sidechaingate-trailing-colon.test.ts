import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

for (const [options, valid] of [
  ["", true],
  ["=threshold=0.125", true],
  ["=threshold=0.125:", true],
  ["=1:", true],
  ["=threshold=0.125::", false],
  ["=threshold=0.125::ratio=2", false],
  ["=threshold=:", false],
  ["=:", false]
] as const) {
  it(`sidechaingate${options} ${valid ? "preserves native PCM" : "rejects empty options"}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)]
    }, { bitsPerSample: 16 }));
    const argumentValues = createCommandArguments([
      "-v", "error", "-i", "/in.wav", "-filter_complex",
      `[0:a][0:a]sidechaingate${options}[o]`, "-map", "[o]", "-f", "s16le", "pipe:1"
    ]);
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { output.push(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    const pcm = Buffer.concat(output);
    if (!valid) {
      assert.notEqual(result.exitCode, 0);
      assert.equal(pcm.length, 0);
      return;
    }
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    // Complete native FFmpeg 7.0.2 PCM16 output, with or without the final colon.
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
      [61, 122, 184, 245, 401, 791, 1410, 2334, 3647, 5441, 7700, 9994]);
  });
}
