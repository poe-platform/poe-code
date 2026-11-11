import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [channels, expected] of [[8, [289, 366]], [6, [193, 263]]] as const) {
  for (const graph of [false, true]) {
    it(`infers the default ${channels}-channel WAV layout for aformat stereo (graph=${graph})`, async () => {
      // Plain PCM WAV, without an extensible speaker mask, as produced by Python wave.
      const input = Buffer.alloc(44 + channels * 2);
      input.write("RIFF");
      input.writeUInt32LE(input.length - 8, 4);
      input.write("WAVEfmt ", 8);
      input.writeUInt32LE(16, 16);
      input.writeUInt16LE(1, 20);
      input.writeUInt16LE(channels, 22);
      input.writeUInt32LE(8000, 24);
      input.writeUInt32LE(8000 * channels * 2, 28);
      input.writeUInt16LE(channels * 2, 32);
      input.writeUInt16LE(16, 34);
      input.write("data", 36);
      input.writeUInt32LE(channels * 2, 40);
      for (let channel = 0; channel < channels; channel++) input.writeInt16LE(100 * channel + 17, 44 + channel * 2);
      const volume = Volume.fromJSON({ "/in.wav": input });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", "[0:a]aformat=cl=stereo[out]", "-map", "[out]"]
            : ["-af", "aformat=channel_layouts=stereo"]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(output);
      assert.equal(pcm.length, 4);
      // Native FFmpeg 7.0.2 reference samples.
      assert.deepEqual([pcm.readInt16LE(0), pcm.readInt16LE(2)], expected);
    });
  }
}
